import asyncio
import json
import math
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, ValidationError
from typing import Optional, List, Dict, Any
import logging
logger = logging.getLogger(__name__)

from backend.collision import CollisionDetector

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

class BladeModel(BaseModel):
    mesh: Mesh
    kinematics: Kinematics

class ObstacleModel(BaseModel):
    mesh: Mesh

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
                
                # On invente un point d'impact par défaut pour éviter le crash plus bas
                impact_x = 0.0
                impact_y = 0.0
                force_magnitude = impact_speed
            else:
                dir_x = vel.endX - vel.startX
                dir_y = vel.endY - vel.startY
                
                # On utilise les vraies coordonnées
                impact_x = vel.endX
                impact_y = vel.endY
                force_magnitude = math.hypot(dir_x, dir_y)
            
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

            print(f"[Solveur] Simulation initiée. Étapes: {num_steps} | Δt: {time_step}s")

            # C. Boucle de calcul temporel (Le streaming)
            for frame_id in range(num_steps+1):
                current_blade_nodes = []
                current_obstacle_nodes = []
                
                # 1. Calcul du déplacement physique réel
                current_time = frame_id * time_step
                
                # Le multiplicateur (ex: * 100) permet d'exagérer visuellement le déplacement 
                # à l'écran pour des temps d'intégration très courts (millisecondes).
                displacement = current_time * impact_speed * 100 
                
                # 2. Application du vecteur sur chaque sommet de la lame
                for pt in blade_vertices:
                    new_x = pt.x + (norm_x * displacement)
                    new_y = pt.y + (norm_y * displacement)
                    # On conserve la propriété d'épaisseur 't'
                    current_blade_nodes.append({"x": new_x, "y": new_y, "t": getattr(pt, 't', 1.0)})
                
                # 3. Maintien des sommets de l'obstacle (Fixes pour l'instant)
                for pt in obstacle_vertices:
                    current_obstacle_nodes.append({"x": pt.x, "y": pt.y, "t": getattr(pt, 't', 1.0)})

                # --- EXÉCUTION DE LA DÉTECTION ET MÉCANIQUE DE CONTACT ---
                contacts = []
                contact_forces = {} # Dictionnaire stockant les forces subies par chaque nœud de la lame
                penalty_stiffness = 1e7 # Constante kp : Très élevée pour empêcher l'interpénétration
                
                if detector:
                    contacts = detector.detect_penetrations(current_blade_nodes)
                    
                    if contacts:
                        for idx_node, idx_el in contacts:
                            node = current_blade_nodes[idx_node]
                            el = detector.obstacle_elements[idx_el]
                            p1 = detector.obstacle_nodes[el.nodes[0]]
                            p2 = detector.obstacle_nodes[el.nodes[1]]
                            p3 = detector.obstacle_nodes[el.nodes[2]]

                            # 1. Calcul du chemin de sortie (géométrie)
                            delta, nx, ny = detector.get_penetration_info(node, p1, p2, p3)

                            # 2. Loi de pénalité : Force = Raideur * Pénétration
                            fx = penalty_stiffness * delta * nx
                            fy = penalty_stiffness * delta * ny
                            
                            contact_forces[idx_node] = {"fx": fx, "fy": fy}
                            
                        print(f"[Étape {frame_id}] {len(contacts)} collisions -> Force maximale générée : {max([math.hypot(f['fx'], f['fy']) for f in contact_forces.values()]):.2f} N")

                # Le signal de fin est strictement lié au nombre d'étapes demandé
                is_last_step = (frame_id == num_steps)

                # --- CALCUL DES CONTRAINTES VISUELLES (HEAT MAP) ---
                stresses = []
                # On détermine le point central de l'impact actuel
                if contact_forces:
                    cx_contact = sum(current_blade_nodes[idx]['x'] for idx in contact_forces.keys()) / len(contact_forces)
                    cy_contact = sum(current_blade_nodes[idx]['y'] for idx in contact_forces.keys()) / len(contact_forces)
                    # On lisse la force maximale pour l'affichage (divisée par 1e6 pour compenser la pénalité gigantesque)
                    max_visual_force = max([math.hypot(f['fx'], f['fy']) for f in contact_forces.values()]) / 1e6
                else:
                    cx_contact, cy_contact, max_visual_force = 0, 0, 0

                # On propage cette force sur les éléments de la lame (Triangles)
                for el in elements:
                    if max_visual_force > 0:
                        p0 = current_blade_nodes[el.nodes[0]]
                        p1 = current_blade_nodes[el.nodes[1]]
                        p2 = current_blade_nodes[el.nodes[2]]
                        
                        # Centre de gravité du triangle
                        cx = (p0['x'] + p1['x'] + p2['x']) / 3.0
                        cy = (p0['y'] + p1['y'] + p2['y']) / 3.0
                        
                        # Plus le triangle est loin de la zone d'impact, moins il subit de contrainte
                        distance = math.hypot(cx - cx_contact, cy - cy_contact)
                        normalized_distance = distance / 15.0 
                        
                        sigma = max_visual_force / ((normalized_distance ** 2) + 1)
                        stresses.append(sigma)
                    else:
                        stresses.append(0.0)

                # 5. Construction STRICTE de la trame attendue par render.js
                frame_payload = {
                    "step": frame_id,
                    "time": current_time,
                    "blade_displacement_cm": displacement, 
                    "blade_nodes": current_blade_nodes,
                    "obstacle_nodes": current_obstacle_nodes,
                    "stresses": stresses,
                    "is_finished": is_last_step 
                }
                
                # 6. Envoi immédiat au navigateur
                await websocket.send_text(json.dumps(frame_payload))
                
                # Légère pause pour cadencer l'animation côté client
                await asyncio.sleep(0.05) 
                
            print("[Solveur] Simulation terminée. En attente d'une nouvelle requête...\n")

    except WebSocketDisconnect:
        # L'utilisateur a fermé la page ou rechargé le navigateur
        print("Déconnexion propre du client WebSocket.")
    except Exception as e:
        print(f"Erreur inattendue du solveur : {e}")



# # Affiche le modèle JSON attendu dans la console au lancement du serveur
# print("\n--- STRUCTURE STRICTE ATTENDUE PAR LE SERVEUR ---")
# print(SimulationPayload.schema_json(indent=2))
# print("-------------------------------------------------\n")       