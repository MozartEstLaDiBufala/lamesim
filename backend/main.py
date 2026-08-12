import asyncio
import json
import math
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, ValidationError
from typing import Optional, List, Dict, Any
import logging
logger = logging.getLogger(__name__)
import numpy as np

from backend.collision import CollisionDetector
from backend.fea import SystemAssembler

app = FastAPI(title="BladeSim API - Streaming Edition")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- 1. Mise à jour des structures de données (Pydantic) ---
class Point(BaseModel):
    x: float
    y: float
    t: float = 1.0 #par defaut

# Modèle pour les éléments avec matériaux
class Element(BaseModel):
    nodes: list[int]
    material: str = "steel"

class Mesh(BaseModel):
    vertices: list[Point] = []
    elements: list[Element] = []

class Velocity(BaseModel):
    startX: float
    startY: float
    endX: float
    endY: float

class Kinematics(BaseModel):
    velocity: Optional[Velocity] = None # pour recevoir "null" sans crasher
    impactSpeed: float = 15.0

class BoundaryConditions(BaseModel):
    fixed_nodes: list[int] = []

class BladeModel(BaseModel):
    mesh: Mesh
    kinematics: Kinematics
    boundary_conditions: Optional[BoundaryConditions] = None

class ObstacleModel(BaseModel):
    mesh: Mesh
    boundary_conditions: Optional[BoundaryConditions] = None

class SimulationPayload(BaseModel):
    scale_factor: float = 0.001
    parameters: Optional[Dict[str, Any]] = None
    blade: BladeModel
    obstacle: Optional[ObstacleModel] = None

# --- 2. Le point de terminaison asynchrone (WebSocket) ---
@app.websocket("/stream")
async def simulation_stream(websocket: WebSocket):

    # A. Le serveur accepte la connexion et garde la porte ouverte
    await websocket.accept()
    print("Connexion WebSocket établie. En attente des données...")
    
    try:
        # B. La boucle infinie : le serveur attend indéfiniment de nouvelles requêtes
        while True:
            # Le script "pause" ici jusqu'à ce que vous cliquiez sur "Envoyer"
            data_text = await websocket.receive_text()
            raw_data = json.loads(data_text)
            
            try:
                # C'est ici que Python compare votre JSON avec la classe Pydantic
                payload = SimulationPayload(**raw_data)
                print("[Solveur] Payload validé avec succès.")

            except ValidationError as e:
                # Si les structures diffèrent, le code entre ici.
                print("\n=== ÉCHEC DE VALIDATION DU PAYLOAD ===")
                
                # Affichage structuré des erreurs exactes
                for error in e.errors():
                    # 'loc' (location) indique le chemin exact de la variable posant problème
                    chemin = " -> ".join([str(loc) for loc in error["loc"]])
                    message = error["msg"]
                    type_erreur = error["type"]
                    print(f"Erreur sur : [{chemin}]")
                    print(f"Raison   : {message} (Type: {type_erreur})\n")
                
                print("=======================================\n")
                
                # Optionnel : Renvoyer l'erreur au frontend avant de fermer
                await websocket.send_json({"error": "Payload invalide", "details": e.errors()})
                return # Stoppe l'exécution pour éviter le crash serveur
            
            blade_vertices = payload.blade.mesh.vertices
            obstacle_vertices = payload.obstacle.mesh.vertices if payload.obstacle else []
            
            elements = payload.blade.mesh.elements # Extraction des nouveaux éléments
            vel = payload.blade.kinematics.velocity
            impact_speed = payload.blade.kinematics.impactSpeed
            
            if vel is None:
                print("[Attention] Aucune flèche reçue. Chute verticale par défaut.")
                dir_x = 0.0
                dir_y = 1.0 # Le vecteur pointe vers le bas
            else:
                dir_x = vel.endX - vel.startX
                dir_y = vel.endY - vel.startY
            
            # Normalisation du vecteur pour le déplacement
            
            length = math.hypot(dir_x, dir_y)
            norm_x = (dir_x / length) if length > 0 else 0.0
            norm_y = (dir_y / length) if length > 0 else 1.0 

            # --- PRÉPARATION DE LA DÉTECTION DE COLLISION ---
            # 1. On récupère les éléments (triangles) spécifiques à l'obstacle
            obstacle_elements = payload.obstacle.mesh.elements if payload.obstacle else []
            
            # 2. On formate les sommets de l'obstacle en dictionnaires pour le CollisionDetector
            initial_obstacle_nodes = [{"x": pt.x, "y": pt.y} for pt in obstacle_vertices]
            
            # 3. Instanciation du détecteur (uniquement si un obstacle existe)
            if initial_obstacle_nodes and obstacle_elements:
                detector = CollisionDetector(initial_obstacle_nodes, obstacle_elements)
            else:
                detector = None

            print(f"[Solveur] Calcul lancé. Vitesse d'impact: {impact_speed} m/s")

            # Extraction des paramètres temporels
            if payload.parameters:
                time_step = payload.parameters.get("time_step", 0.001)
                num_steps = payload.parameters.get("num_steps", 50)
            else:
                time_step = 0.001
                num_steps = 50

            # --- ASSEMBLAGE DES MATRICES GLOBALES FEA ---
            print("[Solveur] Assemblage des matrices FEA en cours...")
            
            # 1. Conversion des nœuds Pydantic en dictionnaires pour notre assembleur
            initial_blade_nodes = [{"x": pt.x, "y": pt.y, "t": getattr(pt, 't', 1.0)} for pt in blade_vertices]
            initial_obstacle_nodes = [{"x": pt.x, "y": pt.y, "t": getattr(pt, 't', 1.0)} for pt in obstacle_vertices]
            
            # 2. Construction de K et M pour la Lame
            if initial_blade_nodes and elements:
                K_blade, M_blade = SystemAssembler.assemble(initial_blade_nodes, elements)
                print(f"[Solveur] Matrice Lame assemblée : {K_blade.shape}")
            else:
                K_blade, M_blade = None, None
                
            # 3. Construction de K et M pour l'Obstacle
            if initial_obstacle_nodes and obstacle_elements:
                K_obstacle, M_obstacle = SystemAssembler.assemble(initial_obstacle_nodes, obstacle_elements)
                print(f"[Solveur] Matrice Obstacle assemblée : {K_obstacle.shape}")
            else:
                K_obstacle, M_obstacle = None, None
                
            # --- INITIALISATION DE LA CINÉMATIQUE (VECTEURS D'ÉTAT) ---
            print("[Solveur] Initialisation des vecteurs cinématiques...")
            
            num_nodes = len(initial_blade_nodes)
            u_blade = np.zeros(2 * num_nodes) # Déplacements
            v_blade = np.zeros(2 * num_nodes) # Vitesses
            a_blade = np.zeros(2 * num_nodes) # Accélérations
            
            # Application de la vitesse d'impact initiale sur l'ensemble de la lame
            for i in range(num_nodes):
                v_blade[2*i] = norm_x * impact_speed
                v_blade[2*i + 1] = norm_y * impact_speed
                
            # Récupération des nœuds encastrés pour les conditions aux limites
            fixed_blade_nodes = payload.blade.boundary_conditions.fixed_nodes if payload.blade.boundary_conditions else []

            print(f"[Solveur] Simulation initiée. Étapes: {num_steps} | Δt: {time_step}s")
            
            # C. Boucle de calcul temporel (Le streaming)
            for frame_id in range(num_steps+1):
                current_time = frame_id * time_step
                
                # 1. Calcul des forces internes (Élasticité du matériau : F_int = K * u)
                if K_blade is not None:
                    F_int = K_blade.dot(u_blade)
                else:
                    F_int = np.zeros(2 * num_nodes)
                
                # 2. Initialisation des forces externes
                F_ext = np.zeros(2 * num_nodes)
                
                # 3. Projection des coordonnées actuelles pour la détection
                current_blade_nodes = []
                for i, pt in enumerate(initial_blade_nodes):
                    current_blade_nodes.append({
                        "x": pt["x"] + u_blade[2*i],
                        "y": pt["y"] + u_blade[2*i + 1],
                        "t": pt["t"]
                    })
                
                # Maintien de l'obstacle fixe
                current_obstacle_nodes = [{"x": pt.x, "y": pt.y, "t": getattr(pt, 't', 1.0)} for pt in obstacle_vertices]

                # 4. Mécanique de contact (Génération de F_ext)
                if detector:
                    contacts = detector.detect_penetrations(current_blade_nodes)
                    penalty_stiffness = 1e11 # Constante de ressort de pénalité
                    
                    for idx_node, idx_el in contacts:
                        node = current_blade_nodes[idx_node]
                        el = detector.obstacle_elements[idx_el]
                        p1 = detector.obstacle_nodes[el.nodes[0]]
                        p2 = detector.obstacle_nodes[el.nodes[1]]
                        p3 = detector.obstacle_nodes[el.nodes[2]]

                        # Pénétration mathématique
                        delta, nx, ny = detector.get_penetration_info(node, p1, p2, p3)

                        # Ajout de la force de pénalité au vecteur de force globale
                        F_ext[2*idx_node] += penalty_stiffness * delta * nx
                        F_ext[2*idx_node + 1] += penalty_stiffness * delta * ny

                # 5. Calcul de l'accélération : a = (F_ext - F_int) / M
                damping_factor = 5.0 # Absorbe les micro-vibrations parasites
                if M_blade is not None:
                    for i in range(2 * num_nodes):
                        if M_blade[i] > 1e-12: # Protection contre la division par zéro
                            # On freine très légèrement la vitesse pour stabiliser le maillage
                            force_amortissement = damping_factor * v_blade[i] * M_blade[i]
                            a_blade[i] = (F_ext[i] - F_int[i] - force_amortissement) / M_blade[i]
                        else:
                            a_blade[i] = 0.0

                # 6. Intégration Explicite (Mise à jour Vitesse puis Déplacement)
                v_blade += a_blade * time_step
                
                # 7. Application stricte des conditions aux limites (Les fixations ne bougent pas)
                for idx in fixed_blade_nodes:
                    v_blade[2*idx] = 0.0
                    v_blade[2*idx + 1] = 0.0
                    u_blade[2*idx] = 0.0
                    u_blade[2*idx + 1] = 0.0

                u_blade += v_blade * time_step

                # 8. Calcul des contraintes réelles (Heat Map physique)
                # La contrainte est désormais proportionnelle aux forces internes générées dans le matériau
                stresses = []
                for el in elements:
                    n1, n2, n3 = el.nodes[0], el.nodes[1], el.nodes[2]
                    # Moyenne des efforts de rappel sur les 3 sommets du triangle
                    f_el = (abs(F_int[2*n1]) + abs(F_int[2*n1+1]) + 
                            abs(F_int[2*n2]) + abs(F_int[2*n2+1]) + 
                            abs(F_int[2*n3]) + abs(F_int[2*n3+1])) / 3.0
                    stresses.append(float(f_el))

                # 9. Construction et envoi du payload final
                is_last_step = (frame_id == num_steps)
                
                frame_payload = {
                    "step": frame_id,
                    "time": current_time,
                    "blade_displacement_cm": float(np.mean(u_blade[1::2])) * 100, # Moyenne du déplacement Y en cm
                    "blade_nodes": current_blade_nodes,
                    "obstacle_nodes": current_obstacle_nodes,
                    "stresses": stresses,
                    "is_finished": is_last_step 
                }
                
                await websocket.send_text(json.dumps(frame_payload))
                await asyncio.sleep(0.05)
                
            print("[Solveur] Simulation terminée. En attente d'une nouvelle requête...\n")

    except WebSocketDisconnect:
        # L'utilisateur a fermé la page ou rechargé le navigateur
        print("Déconnexion propre du client WebSocket.")
    except Exception as e:
        print(f"Erreur inattendue du solveur : {e}")


