import time
import asyncio
import json
import math
import traceback
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, ValidationError
from typing import Optional, List, Dict, Any
import numpy as np

from backend.collision import CollisionDetector
from backend.fea import SystemAssembler
from backend.config_p import settings
from backend.fracture import FractureManager

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
    t: float

# Modèle pour les éléments avec matériaux
class Element(BaseModel):
    nodes: List[int]
    material: str

class Mesh(BaseModel):
    vertices: List[Point] = []
    elements: List[Element] = []

class Velocity(BaseModel):
    startX: float
    startY: float
    endX: float
    endY: float

class Kinematics(BaseModel):
    velocity: Optional[Velocity]
    impactSpeed: float

class BoundaryConditions(BaseModel):
    fixed_nodes: List[int] = []

class BladeModel(BaseModel):
    mesh: Mesh
    kinematics: Kinematics
    boundary_conditions: Optional[BoundaryConditions] = None #par defaut

class ObstacleModel(BaseModel):
    mesh: Mesh
    boundary_conditions: Optional[BoundaryConditions] = None #par defaut

class SimulationPayload(BaseModel):
    scale_factor: float = 0.001
    parameters: Optional[Dict[str, Any]]
    blade: BladeModel
    obstacle: Optional[ObstacleModel] = None #par defaut

# Extraction sécurisée des paramètres du solveur
SOLVER_CONF = settings.get("solver", {})
TIME_STEP_PHYSIQUE = float(SOLVER_CONF.get("time_step_physique"))
PENALTY_STIFFNESS = float(SOLVER_CONF.get("penalty_stiffness"))
DAMPING_FACTOR = float(SOLVER_CONF.get("damping_factor"))

print("\n=== VERIFICATION DES VARIABLES GLOBALES ===")
print(f"TIME_STEP_PHYSIQUE : {TIME_STEP_PHYSIQUE} (Type: {type(TIME_STEP_PHYSIQUE)})")
print(f"PENALTY_STIFFNESS  : {PENALTY_STIFFNESS} (Type: {type(PENALTY_STIFFNESS)})")
print(f"DAMPING_FACTOR     : {DAMPING_FACTOR} (Type: {type(DAMPING_FACTOR)})")
print("===========================================\n")

# --- 2. Le point de terminaison asynchrone (WebSocket) ---
@app.websocket("/stream")
async def simulation_stream(websocket: WebSocket):

    # A. Le serveur accepte la connexion et garde la porte ouverte
    await websocket.accept()
    print("[DEBUG WEBSOCKET] Client connecté.")
    
    try:
        # B. La boucle infinie : le serveur attend indéfiniment de nouvelles requêtes
        while True:
            # Le script "pause" ici jusqu'à ce que vous cliquiez sur "Envoyer"
            data_text = await websocket.receive_text()
            raw_data = json.loads(data_text)
            
            try:
                # C'est ici que Python compare votre JSON avec la classe Pydantic
                payload = SimulationPayload(**raw_data)
                print("[DEBUG WEBSOCKET] Payload validé.")

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
            print(f"PRÉPARATION DE LA DÉTECTION DE COLLISION")
            if payload.parameters:
                # "simulate_time" correspond à "Durée réelle à simuler"
                total_simulated_time = payload.parameters.get("simulate_time", 0.05)
                # "num_steps" correspond au "Nombre d'étapes"
                num_steps = int(payload.parameters.get("num_steps",50))
            else:
                total_simulated_time = 0.05
                num_steps = 50

            # --- 1. CONFIGURATION DU DÉCOUPLAGE TEMPOREL ---
            print(f"1. CONFIGURATION DU DÉCOUPLAGE TEMPOREL")
            # Calcul du temps qui s'écoule entre deux images affichées à l'écran
            temps_visuel_par_frame = total_simulated_time / num_steps 
            
            # Nombre de fois où le moteur physique doit tourner pour générer une frame
            sub_steps = int(temps_visuel_par_frame / TIME_STEP_PHYSIQUE) 
            
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
            
            # 2. Construction des propriétés et M pour la Lame
            if initial_blade_nodes and elements:
                blade_elements_data, M_blade = SystemAssembler.precompute_system(initial_blade_nodes, elements, scale_factor)
                print(f"[Solveur] Lame pré-calculée : {len(blade_elements_data)} éléments.")
            else:
                blade_elements_data, M_blade = [], None
                
            # 3. Construction des propriétés et M pour l'Obstacle
            if initial_obstacle_nodes and obstacle_elements:
                obstacle_elements_data, M_obstacle = SystemAssembler.precompute_system(initial_obstacle_nodes, obstacle_elements, scale_factor)
                print(f"[Solveur] Obstacle pré-calculé : {len(obstacle_elements_data)} éléments.")
            else:
                obstacle_elements_data, M_obstacle = [], None

            # --- CONVERSION EN TENSEURS 3D (VECTORISATION) ---
            print("[Solveur] Vectorisation des matrices en cours...")
            
            # Lame
            if M_blade is not None:
                blade_ddls = np.array([el['ddls'] for el in blade_elements_data], dtype=np.int32)
                blade_B = np.array([el['B'] for el in blade_elements_data])
                blade_D = np.array([el['D'] for el in blade_elements_data])
                blade_vol = np.array([el['A'] * el['t'] for el in blade_elements_data])
                blade_fractured = np.zeros(len(blade_elements_data), dtype=bool)
            else:
                blade_ddls, blade_B, blade_D, blade_vol = None, None, None, None

            # Obstacle
            if M_obstacle is not None:
                obs_ddls = np.array([el['ddls'] for el in obstacle_elements_data], dtype=np.int32)
                obs_B = np.array([el['B'] for el in obstacle_elements_data])
                obs_D = np.array([el['D'] for el in obstacle_elements_data])
                obs_vol = np.array([el['A'] * el['t'] for el in obstacle_elements_data])
                obs_fractured = np.zeros(len(obstacle_elements_data), dtype=bool)
            else:
                obs_ddls, obs_B, obs_D, obs_vol = None, None, None, None
            # ---------------------------------------------------


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
            print(f"LA DOUBLE BOUCLE")
            # Boucle externe : Gère ce que l'utilisateur voit
            for frame_id in range(num_steps + 1):

                # 1. Projection dynamique des nœuds (Lame)
                current_blade_nodes = []
                num_current_blade_nodes = len(u_blade) // 2
                
                for i in range(num_current_blade_nodes):

                    if i < len(initial_blade_nodes):
                        pt = initial_blade_nodes[i]
                    else:
                        pt = initial_blade_nodes[0]

                    #pt = initial_blade_nodes[i]
                    current_blade_nodes.append({
                        "x": float(pt["x"] + u_blade[2*i] / scale_factor),
                        "y": float(pt["y"] + u_blade[2*i+1] / scale_factor)
                    })
                
                # 2. Projection dynamique des nœuds (Obstacle)
                current_obstacle_nodes = []
                num_current_obs_nodes = len(u_obs) // 2
                
                for i in range(num_current_obs_nodes):

                    if i < len(initial_obstacle_nodes):
                        pt = initial_obstacle_nodes[i]
                    else:
                        pt = initial_obstacle_nodes[0]

                    #pt = initial_obstacle_nodes[i]
                    
                    current_obstacle_nodes.append({
                        "x": float(pt["x"] + u_obs[2*i] / scale_factor),
                        "y": float(pt["y"] + u_obs[2*i+1] / scale_factor)
                    })

                # 3. Extraction de la connectivité dynamique (NOUVEAU)
                current_blade_elements = [el['nodes'] for el in blade_elements_data] if M_blade is not None else []
                current_obstacle_elements = [el['nodes'] for el in obstacle_elements_data] if M_obstacle is not None else []

                # 4. Construction et ENVOI du payload
                current_time = frame_id * temps_visuel_par_frame
                
                frame_payload = {
                    "step": frame_id,
                    "time": current_time,
                    "blade_displacement_cm": float(np.mean(u_blade[1::2])) * 100,
                    "blade_nodes": current_blade_nodes,
                    "obstacle_nodes": current_obstacle_nodes,
                    "blade_elements": current_blade_elements,       
                    "obstacle_elements": current_obstacle_elements, 
                    "blade_elements": current_blade_elements,       
                    "obstacle_elements": current_obstacle_elements, 
                    "stresses": stresses,
                    "is_finished": (frame_id == num_steps)
                }
                
                # On envoie l'état au navigateur
                await websocket.send_text(json.dumps(frame_payload))
                await asyncio.sleep(0.01) # Pause réseau minimale

                # --- CHRONOMÉTRAGE DE LA FRAME ---
                t_contact = 0.0
                t_forces = 0.0
                t_fracture = 0.0

                # 3. Calcul de l'état physique SUIVANT (Ignoré si on est à la dernière frame)
                if frame_id < num_steps:

                    # --- BOUCLE INTERNE : LA PHYSIQUE PURE ---
                    for _ in range(sub_steps):

                        #chrono
                        start_time = time.perf_counter()

                        # 1. Calcul des forces internes
                        # Réinitialisation des vecteurs de force globale
                        F_int = np.zeros(2 * num_nodes)
                        F_int_obs = np.zeros(2 * num_obs_nodes)
                        
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
                            
                            for idx_node, idx_el in contacts:
                                node = current_blade_nodes[idx_node]
                                el = detector.obstacle_elements[idx_el]
                                n1, n2, n3 = el.nodes[0], el.nodes[1], el.nodes[2]
                                p1, p2, p3 = detector.obstacle_nodes[n1], detector.obstacle_nodes[n2], detector.obstacle_nodes[n3]

                                # delta est retourné en PIXELS
                                delta, nx, ny = detector.get_penetration_info(node, p1, p2, p3)
                                
                                # On doit convertir la pénétration en MÈTRES pour le calcul de la force
                                delta_m = delta * scale_factor
                                
                                force_x = PENALTY_STIFFNESS * delta_m * nx
                                force_y = PENALTY_STIFFNESS * delta_m * ny

                                F_ext[2*idx_node] += force_x
                                F_ext[2*idx_node + 1] += force_y
                                
                                F_ext_obs[2*n1] -= force_x / 3.0
                                F_ext_obs[2*n1+1] -= force_y / 3.0
                                F_ext_obs[2*n2] -= force_x / 3.0
                                F_ext_obs[2*n2+1] -= force_y / 3.0
                                F_ext_obs[2*n3] -= force_x / 3.0
                                F_ext_obs[2*n3+1] -= force_y / 3.0

                        #chrono
                        t_contact += (time.perf_counter() - start_time)
                        start_time = time.perf_counter()

                        # --- 4.1. Accumulation Vectorisée des Forces Internes ---
                        # Pour la Lame
                        if M_blade is not None:
                            # 1. Extraction locale : shape (N, 6)
                            u_e_blade = u_blade[blade_ddls]
                            
                            # 2. Déformation (epsilon) : shape (N, 3)
                            epsilon_blade = np.einsum('eij,ej->ei', blade_B, u_e_blade)
                            
                            # 3. Contrainte (sigma) : shape (N, 3)
                            # NOUS SAUVEGARDONS CE TENSEUR POUR L'ALGORITHME DE FRACTURE
                            sigma_blade = np.einsum('eij,ej->ei', blade_D, epsilon_blade)
                            
                            # 4. Forces nodales locales : shape (N, 6)
                            F_e_blade = np.einsum('eji,ej->ei', blade_B, sigma_blade) * blade_vol[:, np.newaxis]
                            
                            # 5. Injection globale (Scatter Add C-optimisé)
                            np.add.at(F_int, blade_ddls.ravel(), F_e_blade.ravel())

                        # Pour l'Obstacle
                        if M_obstacle is not None:
                            u_e_obs = u_obs[obs_ddls]
                            epsilon_obs = np.einsum('eij,ej->ei', obs_B, u_e_obs)
                            sigma_obs = np.einsum('eij,ej->ei', obs_D, epsilon_obs)
                            F_e_obs = np.einsum('eji,ej->ei', obs_B, sigma_obs) * obs_vol[:, np.newaxis]
                            np.add.at(F_int_obs, obs_ddls.ravel(), F_e_obs.ravel())

                        # --- 4.2. Calcul des Accélérations (Loi de Newton) ---
                        if M_blade is not None:
                            for i in range(2 * num_nodes):
                                m_eff = max(M_blade[i], 0.05) # Mass Scaling pour la stabilité
                                a_blade[i] = (F_ext[i] - F_int[i] - DAMPING_FACTOR * v_blade[i] * m_eff) / m_eff
                        
                        if M_obstacle is not None:
                            for i in range(2 * num_obs_nodes):
                                m_eff_o = max(M_obstacle[i], 0.05)
                                a_obs[i] = (F_ext_obs[i] - F_int_obs[i] - DAMPING_FACTOR * v_obs[i] * m_eff_o) / m_eff_o

                        # 5. Intégration (Mise à jour des vitesses)
                        v_blade += a_blade * TIME_STEP_PHYSIQUE
                        v_obs += a_obs * TIME_STEP_PHYSIQUE
                        
                        # 6. Verrouillage des conditions aux limites
                        for idx in fixed_blade_nodes:
                            if 2*idx + 1 < len(v_blade): # Sécurité de taille
                                v_blade[2*idx] = 0.0 ; v_blade[2*idx + 1] = 0.0
                        for idx in fixed_obs_nodes:
                            if 2*idx + 1 < len(v_obs):
                                v_obs[2*idx] = 0.0 ; v_obs[2*idx + 1] = 0.0

                        # 7. Mise à jour des déplacements
                        u_blade += v_blade * TIME_STEP_PHYSIQUE
                        u_obs += v_obs * TIME_STEP_PHYSIQUE

                        #chrono
                        t_forces += (time.perf_counter() - start_time)
                        start_time = time.perf_counter()

                        # --- 8. MÉCANIQUE DE LA RUPTURE (Fracture Mechanics) ---
                        if M_blade is not None:
                            blade_elements_data, u_blade, v_blade, a_blade, M_blade, blade_ddls, blade_fractured, cracked_b, split_parents_b = \
                                FractureManager.process_fracture_vectorized(
                                    blade_elements_data, u_blade, v_blade, a_blade, M_blade, 
                                    sigma_blade, blade_ddls, blade_fractured, "steel"
                                )
                            if cracked_b:
                                # Le nouveau nœud hérite des coordonnées absolues de son parent
                                for p_idx in split_parents_b:
                                    initial_blade_nodes.append(initial_blade_nodes[p_idx].copy())
                                num_nodes = len(u_blade) // 2
                                
                        if M_obstacle is not None:
                            obstacle_elements_data, u_obs, v_obs, a_obs, M_obstacle, obs_ddls, obs_fractured, cracked_o, split_parents_o = \
                                FractureManager.process_fracture_vectorized(
                                    obstacle_elements_data, u_obs, v_obs, a_obs, M_obstacle, 
                                    sigma_obs, obs_ddls, obs_fractured, "wood"
                                )
                            if cracked_o:
                                for p_idx in split_parents_o:
                                    initial_obstacle_nodes.append(initial_obstacle_nodes[p_idx].copy())
                                num_obs_nodes = len(u_obs) // 2

                        
                        t_fracture += (time.perf_counter() - start_time)

                    # --- FIN DE LA BOUCLE INTERNE ---

                    # Le temps visuel calculé est transmis au frontend
                    current_time = frame_id * temps_visuel_par_frame

                    # 9. Calcul vectorisé de Von Mises (Heat Map)
                    if M_blade is not None:
                        sig_x = sigma_blade[:, 0]
                        sig_y = sigma_blade[:, 1]
                        tau_xy = sigma_blade[:, 2]
                        # Calcul global de Von Mises en une seule passe
                        von_mises = np.sqrt(sig_x**2 + sig_y**2 - sig_x*sig_y + 3 * tau_xy**2)
                        stresses = von_mises.tolist()
                    else:
                        stresses = []

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
                        "blade_elements": current_blade_elements,       
                        "obstacle_elements": current_obstacle_elements, 
                        "stresses": stresses,
                        "is_finished": (frame_id == num_steps)
                    }

                    # Affichage des statistiques dans la console pour cette frame
                    total_frame_time = t_contact + t_forces + t_fracture
                    if total_frame_time > 0:
                        print(f"\n[FRAME {frame_id}] Temps total calcul : {total_frame_time:.3f} s")
                        print(f" -> Contact  : {(t_contact/total_frame_time)*100:.1f}% ({t_contact:.3f} s)")
                        print(f" -> Forces   : {(t_forces/total_frame_time)*100:.1f}% ({t_forces:.3f} s)")
                        print(f" -> Fracture : {(t_fracture/total_frame_time)*100:.1f}% ({t_fracture:.3f} s)")
                    
                    await websocket.send_text(json.dumps(frame_payload))
                    await asyncio.sleep(0.05)
                
            print("[Solveur] Simulation terminée. En attente d'une nouvelle requête...\n")

    except WebSocketDisconnect:
        # L'utilisateur a fermé la page ou rechargé le navigateur
        print("Déconnexion propre du client WebSocket.")
    except Exception as e:
        print(f"Erreur inattendue du solveur : {e}")


