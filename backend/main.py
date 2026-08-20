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
    impactSpeed: float = 14.0

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
    parameters: Optional[Dict[str, Any]]
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
            # --- EXTRACTION DES PARAMÈTRES VISUELS (Depuis le frontend) ---
            if payload.parameters:
                # "simulate_time" correspond à "Durée réelle à simuler" (ex: 3.0 s)
                total_simulated_time = payload.parameters.get("simulate_time", 0.05)
                # "num_steps" correspond au "Nombre d'étapes" (ex: 50 frames)
                num_steps = int(payload.parameters.get("num_steps",50))
            else:
                total_simulated_time = 0.05
                num_steps = 50

            # --- 1. CONFIGURATION DU DÉCOUPLAGE TEMPOREL ---
            time_step_physique = 0.00002  # Pas physique ultra-fin pour la stabilité (20µs)
            
            # Calcul du temps qui s'écoule entre deux images affichées à l'écran
            temps_visuel_par_frame = total_simulated_time / num_steps 
            
            # Nombre de fois où le moteur physique doit tourner pour générer une frame
            sub_steps = int(temps_visuel_par_frame / time_step_physique) 
            
            print(f"[Solveur] Simulation: {total_simulated_time}s | Frames: {num_steps}")
            print(f"[Solveur] Découplage activé : {sub_steps} calculs physiques par image visuelle.")

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

            # --- ASSEMBLAGE DES MATRICES GLOBALES FEA ---
            print("[Solveur] Assemblage des matrices FEA en cours...")
            
            # 1. Conversion des nœuds Pydantic en dictionnaires pour notre assembleur
            initial_blade_nodes = [{"x": pt.x, "y": pt.y, "t": getattr(pt, 't', 1.0)} for pt in blade_vertices]
            initial_obstacle_nodes = [{"x": pt.x, "y": pt.y, "t": getattr(pt, 't', 1.0)} for pt in obstacle_vertices]
            scale_factor = payload.scale_factor # On récupère l'échelle du JSON
            
            # 2. Construction de K et M pour la Lame
            if initial_blade_nodes and elements:
                K_blade, M_blade = SystemAssembler.assemble(initial_blade_nodes, elements, scale_factor)
                print(f"[Solveur] Matrice Lame assemblée : {K_blade.shape}")
            else:
                K_blade, M_blade = None, None
                
            # 3. Construction de K et M pour l'Obstacle
            if initial_obstacle_nodes and obstacle_elements:
                K_obstacle, M_obstacle = SystemAssembler.assemble(initial_obstacle_nodes, obstacle_elements, scale_factor)
                print(f"[Solveur] Matrice Obstacle assemblée : {K_obstacle.shape}")
            else:
                K_obstacle, M_obstacle = None, None
                
            # --- INITIALISATION DE LA CINÉMATIQUE (VECTEURS D'ÉTAT) ---
            print("[Solveur] Initialisation des vecteurs cinématiques...")
            
            # --- INITIALISATION DE LA CINÉMATIQUE DE LA LAME ---
            num_nodes = len(initial_blade_nodes)
            u_blade = np.zeros(2 * num_nodes) # Déplacements
            v_blade = np.zeros(2 * num_nodes) # Vitesses
            a_blade = np.zeros(2 * num_nodes) # Accélérations

            # --- INITIALISATION DE LA CINÉMATIQUE DE L'OBSTACLE ---
            num_obs_nodes = len(initial_obstacle_nodes)
            u_obs = np.zeros(2 * num_obs_nodes) # Déplacements de l'obstacle
            v_obs = np.zeros(2 * num_obs_nodes) # Vitesses de l'obstacle
            a_obs = np.zeros(2 * num_obs_nodes) # Accélérations de l'obstacle

            # Application de la vitesse d'impact initiale sur l'ensemble de la lame
            for i in range(num_nodes):
                v_blade[2*i] = norm_x * impact_speed
                v_blade[2*i + 1] = norm_y * impact_speed
                
            # Récupération des nœuds encastrés pour les conditions aux limites
            fixed_blade_nodes = payload.blade.boundary_conditions.fixed_nodes if payload.blade.boundary_conditions else []
            fixed_obs_nodes = payload.obstacle.boundary_conditions.fixed_nodes if payload.obstacle.boundary_conditions else []

            # --- INITIALISATION DU FICHIER DE DIAGNOSTIC ---
            log_filename = "diagnostic_physique.csv"
            with open(log_filename, "w") as f:
                f.write("step,time,max_u_blade,max_F_ext_blade,max_F_int_blade,max_stress,max_u_obs\n")

            # Initialisation des contraintes à vide pour la frame 0
            stresses = [0.0] * len(elements)

            # --- LA DOUBLE BOUCLE ---
            # Boucle externe : Gère ce que l'utilisateur voit
            for frame_id in range(num_steps + 1):
                # 1. Projection des nœuds à l'instant T (Pour la frame 0, u_blade vaut 0)
                current_blade_nodes = [
                    {"x": float(pt["x"] + u_blade[2*i] / scale_factor), 
                     "y": float(pt["y"] + u_blade[2*i+1] / scale_factor)} 
                    for i, pt in enumerate(initial_blade_nodes)
                ]
                                    
                current_obstacle_nodes = [
                    {"x": float(pt["x"] + u_obs[2*i] / scale_factor), 
                     "y": float(pt["y"] + u_obs[2*i+1] / scale_factor)} 
                    for i, pt in enumerate(initial_obstacle_nodes)
                ]
                
                # 2. Construction et ENVOI du payload avant de modifier la physique
                current_time = frame_id * temps_visuel_par_frame
                
                frame_payload = {
                    "step": frame_id,      # CORRECTION : Utilisation dynamique de frame_id
                    "time": current_time,  # CORRECTION : Utilisation du temps calculé
                    "blade_displacement_cm": float(np.mean(u_blade[1::2])) * 100,
                    "blade_nodes": current_blade_nodes,
                    "obstacle_nodes": current_obstacle_nodes,
                    "stresses": stresses,
                    "is_finished": (frame_id == num_steps)
                }
                
                # On envoie l'état au navigateur
                await websocket.send_text(json.dumps(frame_payload))
                await asyncio.sleep(0.01) # Pause réseau minimale
                
                # 3. Calcul de l'état physique SUIVANT (Ignoré si on est à la dernière frame)
                if frame_id < num_steps:

                    # --- BOUCLE INTERNE : LA PHYSIQUE PURE ---
                    for _ in range(sub_steps):
                        
                        # 1. Calcul des forces internes
                        F_int = K_blade.dot(u_blade) if K_blade is not None else np.zeros(2 * num_nodes)
                        F_int_obs = K_obstacle.dot(u_obs) if K_obstacle is not None else np.zeros(2 * num_obs_nodes)
                        
                        F_ext = np.zeros(2 * num_nodes)
                        F_ext_obs = np.zeros(2 * num_obs_nodes)

                        # 2. Projection pour la détection
                        current_blade_nodes = [
                            {"x": float(pt["x"] + u_blade[2*i] / scale_factor), 
                            "y": float(pt["y"] + u_blade[2*i+1] / scale_factor)} 
                            for i, pt in enumerate(initial_blade_nodes)
                        ]
                        
                        current_obstacle_nodes = [
                            {"x": float(pt["x"] + u_obs[2*i] / scale_factor), 
                            "y": float(pt["y"] + u_obs[2*i+1] / scale_factor)} 
                            for i, pt in enumerate(initial_obstacle_nodes)
                        ]

                        # 3. Mécanique de contact
                        if detector:
                            contacts = detector.detect_penetrations(current_blade_nodes)
                            penalty_stiffness = 1e5  
                            
                            for idx_node, idx_el in contacts:
                                node = current_blade_nodes[idx_node]
                                el = detector.obstacle_elements[idx_el]
                                n1, n2, n3 = el.nodes[0], el.nodes[1], el.nodes[2]
                                p1, p2, p3 = detector.obstacle_nodes[n1], detector.obstacle_nodes[n2], detector.obstacle_nodes[n3]

                                # delta est retourné en PIXELS
                                delta, nx, ny = detector.get_penetration_info(node, p1, p2, p3)
                                
                                # On doit convertir la pénétration en MÈTRES pour le calcul de la force
                                delta_m = delta * scale_factor
                                
                                force_x = penalty_stiffness * delta_m * nx
                                force_y = penalty_stiffness * delta_m * ny

                                F_ext[2*idx_node] += force_x
                                F_ext[2*idx_node + 1] += force_y
                                
                                F_ext_obs[2*n1] -= force_x / 3.0
                                F_ext_obs[2*n1+1] -= force_y / 3.0
                                F_ext_obs[2*n2] -= force_x / 3.0
                                F_ext_obs[2*n2+1] -= force_y / 3.0
                                F_ext_obs[2*n3] -= force_x / 3.0
                                F_ext_obs[2*n3+1] -= force_y / 3.0

                        # 4. Accélérations
                        damping_factor = 15.0
                        
                        if M_blade is not None:
                            for i in range(2 * num_nodes):
                                m_eff = max(M_blade[i], 0.05)
                                a_blade[i] = (F_ext[i] - F_int[i] - damping_factor * v_blade[i] * m_eff) / m_eff
                        
                        if M_obstacle is not None:
                            for i in range(2 * num_obs_nodes):
                                m_eff_o = max(M_obstacle[i], 0.05)
                                a_obs[i] = (F_ext_obs[i] - F_int_obs[i] - damping_factor * v_obs[i] * m_eff_o) / m_eff_o

                        # 5. Intégration (Attention : on utilise time_step_physique, pas time_step global)
                        v_blade += a_blade * time_step_physique
                        v_obs += a_obs * time_step_physique
                        
                        # 6. Verrouillage des conditions aux limites
                        for idx in fixed_blade_nodes:
                            v_blade[2*idx] = 0.0 ; v_blade[2*idx + 1] = 0.0
                        for idx in fixed_obs_nodes:
                            v_obs[2*idx] = 0.0 ; v_obs[2*idx + 1] = 0.0

                        # 7. Mise à jour des déplacements
                        u_blade += v_blade * time_step_physique
                        u_obs += v_obs * time_step_physique
                    
                    # --- FIN DE LA BOUCLE INTERNE ---

                    # Le temps visuel calculé est transmis au frontend
                    current_time = frame_id * temps_visuel_par_frame

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

                    # --- ÉCRITURE DES DONNÉES DE DIAGNOSTIC ---
                    max_u = float(np.max(np.abs(u_blade)))
                    max_f_ext = float(np.max(np.abs(F_ext)))
                    max_f_int = float(np.max(np.abs(F_int)))
                    max_stress = float(max(stresses)) if stresses else 0.0
                    max_u_o = float(np.max(np.abs(u_obs))) if len(u_obs) > 0 else 0.0

                    # enregistrement csv
                    with open(log_filename, "a") as f:
                        f.write(f"{frame_id},{current_time:.6f},{max_u:.5e},{max_f_ext:.5e},{max_f_int:.5e},{max_stress:.5e},{max_u_o:.5e}\n")

                    frame_payload = {
                        "step": frame_id+1,
                        "time": current_time,
                        "blade_displacement_cm": float(np.mean(u_blade[1::2])) * 100, # Moyenne du déplacement Y en cm
                        "blade_nodes": current_blade_nodes,
                        "obstacle_nodes": current_obstacle_nodes,
                        "stresses": stresses,
                        "is_finished": (frame_id == num_steps)
                    }
                    
                    await websocket.send_text(json.dumps(frame_payload))
                    await asyncio.sleep(0.05)
                
            print("[Solveur] Simulation terminée. En attente d'une nouvelle requête...\n")

    except WebSocketDisconnect:
        # L'utilisateur a fermé la page ou rechargé le navigateur
        print("Déconnexion propre du client WebSocket.")
    except Exception as e:
        print(f"Erreur inattendue du solveur : {e}")


