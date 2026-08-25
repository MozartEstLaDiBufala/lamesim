import json
import csv
import time
import numpy as np
import sys
import os
import itertools
from tqdm import tqdm

# --- CORRECTION DU CHEMIN POUR PYTHON ---
# On indique à Python de reculer d'un dossier pour se placer à la racine du projet.
# Cela lui permet de comprendre "from backend..." exactement comme le serveur Web.
current_dir = os.path.dirname(os.path.abspath(__file__))
parent_dir = os.path.dirname(current_dir)
sys.path.insert(0, parent_dir)

# Importation de vos modules internes (ajustez si besoin)
from backend.fea import SystemAssembler
from backend.collision import CollisionDetector
from backend.fracture import FractureManager

from backend.config_p import settings
MATERIALS = settings.get("materials", {})

def run_headless_simulation(json_path, params, frames=15, sub_steps=1000):
    """
    Exécute la physique pure sans aucun websocket ni rendu visuel.
    """
    # 1. SURCHARGE DYNAMIQUE DES MATÉRIAUX EN MÉMOIRE
    # On met à jour les propriétés avant que l'assembleur ne fasse ses calculs
    MATERIALS["steel"]["E"] = params["steel_E"]
    MATERIALS["steel"]["nu"] = params["steel_nu"]
    MATERIALS["steel"]["sigma_yield"] = params["steel_sigma_yield"]
    MATERIALS["steel"]["limit_strain"] = params["steel_limit_strain"]
    
    MATERIALS["wood"]["E"] = params["wood_E"]
    MATERIALS["wood"]["nu"] = params["wood_nu"]
    MATERIALS["wood"]["sigma_uts"] = params["wood_sigma_uts"]
    MATERIALS["wood"]["limit_strain"] = params["wood_limit_strain"]

    # 2. Paramètres globaux du solveur
    PENALTY_STIFFNESS = params["penalty_stiffness"]
    CONTACT_DAMPING = params["contact_damping"]
    DAMPING_FACTOR = params["damping_factor"]
    TIME_STEP_PHYSIQUE = 1.0e-6
    scale_factor = 0.001

    # 2. Chargement de la géométrie initiale depuis le JSON
    with open(json_path, 'r', encoding='utf-8') as f:
        payload = json.load(f)

    # --- SIMULATION DE L'OBJET PYDANTIC ---
    class MockElement:
        def __init__(self, el_dict):
            self.nodes = el_dict["nodes"]
            self.material = el_dict.get("material", "steel")

    # Extraction des sommets (vertices)
    initial_blade_nodes = payload["blade"]["mesh"]["vertices"]
    initial_obs_nodes = payload["obstacle"]["mesh"]["vertices"]
    
    # Extraction et conversion des dictionnaires en objets pour l'assembleur
    blade_elements = [MockElement(el) for el in payload["blade"]["mesh"]["elements"]]
    obs_elements = [MockElement(el) for el in payload["obstacle"]["mesh"]["elements"]]
    
    # Conditions aux limites (fixedNodes)
    fixed_blade_nodes = payload["blade"].get("fixedNodes", [])
    fixed_obs_nodes = payload["obstacle"].get("fixedNodes", [])

    # Vitesse d'impact
    impact_speed = payload["blade"]["kinematics"].get("impactSpeed", 14.0)

    # 3. Assemblage Initial
    blade_elements_data, M_blade = SystemAssembler.precompute_system(
        initial_blade_nodes, blade_elements, scale_factor
    )
    obstacle_elements_data, M_obstacle = SystemAssembler.precompute_system(
        initial_obs_nodes, obs_elements, scale_factor
    )

    # Variables cinématiques
    num_nodes = len(initial_blade_nodes)
    num_obs_nodes = len(initial_obs_nodes)
    
    u_blade, v_blade, a_blade = np.zeros(2*num_nodes), np.zeros(2*num_nodes), np.zeros(2*num_nodes)
    u_obs, v_obs, a_obs = np.zeros(2*num_obs_nodes), np.zeros(2*num_obs_nodes), np.zeros(2*num_obs_nodes)

    # Vitesse d'impact
    impact_speed = payload["blade"]["kinematics"].get("impactSpeed", 14.0)
    v_blade[0::2] = impact_speed

    # Initialisation du détecteur
    detector = CollisionDetector(initial_obs_nodes, obs_elements)

    results = []

    # --- LA DOUBLE BOUCLE (Sans interface web) ---
    for frame_id in range(frames):
        max_stress_frame = 0.0
        
        # --- BOUCLE INTERNE : LA PHYSIQUE PURE ---
        for _ in range(sub_steps):
            
            F_int = np.zeros(2 * num_nodes)
            F_int_obs = np.zeros(2 * num_obs_nodes)
            F_ext = np.zeros(2 * num_nodes)
            F_ext_obs = np.zeros(2 * num_obs_nodes)

            # 1. Projection pour la détection
            current_blade_nodes = [
                {"x": float(pt["x"] + u_blade[2*i] / scale_factor), 
                 "y": float(pt["y"] + u_blade[2*i+1] / scale_factor)} 
                for i, pt in enumerate(initial_blade_nodes)
            ]
            
            current_obstacle_nodes = [
                {"x": float(pt["x"] + u_obs[2*i] / scale_factor), 
                 "y": float(pt["y"] + u_obs[2*i+1] / scale_factor)} 
                for i, pt in enumerate(initial_obs_nodes)
            ]

            # 2. Mécanique de contact
            if detector:
                contacts = detector.detect_penetrations(current_blade_nodes) 
                for idx_node, idx_el in contacts:
                    node = current_blade_nodes[idx_node]
                    el = detector.obstacle_elements[idx_el]
                    n1, n2, n3 = el.nodes[0], el.nodes[1], el.nodes[2]
                    p1, p2, p3 = detector.obstacle_nodes[n1], detector.obstacle_nodes[n2], detector.obstacle_nodes[n3]

                    delta, nx, ny = detector.get_penetration_info(node, p1, p2, p3)
                    delta_m = delta * scale_factor
                    
                    force_x_spring = PENALTY_STIFFNESS * delta_m * nx
                    force_y_spring = PENALTY_STIFFNESS * delta_m * ny

                    v_bx = v_blade[2*idx_node]
                    v_by = v_blade[2*idx_node + 1]
                    v_ox = (v_obs[2*n1] + v_obs[2*n2] + v_obs[2*n3]) / 3.0
                    v_oy = (v_obs[2*n1+1] + v_obs[2*n2+1] + v_obs[2*n3+1]) / 3.0
                    
                    v_rel_x = v_bx - v_ox
                    v_rel_y = v_by - v_oy
                    v_rel_n = v_rel_x * nx + v_rel_y * ny
                    
                    force_x_damp = -CONTACT_DAMPING * v_rel_n * nx
                    force_y_damp = -CONTACT_DAMPING * v_rel_n * ny
                    
                    force_x = force_x_spring + force_x_damp
                    force_y = force_y_spring + force_y_damp

                    F_ext[2*idx_node] += force_x
                    F_ext[2*idx_node + 1] += force_y
                    
                    F_ext_obs[2*n1] -= force_x / 3.0
                    F_ext_obs[2*n1+1] -= force_y / 3.0
                    F_ext_obs[2*n2] -= force_x / 3.0
                    F_ext_obs[2*n2+1] -= force_y / 3.0
                    F_ext_obs[2*n3] -= force_x / 3.0
                    F_ext_obs[2*n3+1] -= force_y / 3.0

            # 3. Accumulation Vectorisée des Forces Internes
            sigma_blade = np.array([])
            if M_blade is not None and len(blade_elements_data) > 0:
                blade_ddls = np.array([el['ddls'] for el in blade_elements_data])
                blade_B = np.array([el['B'] for el in blade_elements_data])
                blade_D = np.array([el['D'] for el in blade_elements_data])
                blade_vol = np.array([el['t'] * el['A'] for el in blade_elements_data])

                u_e_blade = u_blade[blade_ddls]
                epsilon_blade = np.einsum('eij,ej->ei', blade_B, u_e_blade)
                sigma_blade = np.einsum('eij,ej->ei', blade_D, epsilon_blade)
                F_e_blade = np.einsum('eji,ej->ei', blade_B, sigma_blade) * blade_vol[:, np.newaxis]
                np.add.at(F_int, blade_ddls.ravel(), F_e_blade.ravel())

            sigma_obs = np.array([])
            if M_obstacle is not None and len(obstacle_elements_data) > 0:
                obs_ddls = np.array([el['ddls'] for el in obstacle_elements_data])
                obs_B = np.array([el['B'] for el in obstacle_elements_data])
                obs_D = np.array([el['D'] for el in obstacle_elements_data])
                obs_vol = np.array([el['t'] * el['A'] for el in obstacle_elements_data])

                u_e_obs = u_obs[obs_ddls]
                epsilon_obs = np.einsum('eij,ej->ei', obs_B, u_e_obs)
                sigma_obs = np.einsum('eij,ej->ei', obs_D, epsilon_obs)
                F_e_obs = np.einsum('eji,ej->ei', obs_B, sigma_obs) * obs_vol[:, np.newaxis]
                np.add.at(F_int_obs, obs_ddls.ravel(), F_e_obs.ravel())

            # 4. Accélérations et Intégration
            if M_blade is not None:
                for i in range(2 * num_nodes):
                    m_eff = max(M_blade[i], 0.05)
                    a_blade[i] = (F_ext[i] - F_int[i] - DAMPING_FACTOR * v_blade[i] * m_eff) / m_eff
            
            if M_obstacle is not None:
                for i in range(2 * num_obs_nodes):
                    m_eff_o = max(M_obstacle[i], 0.05)
                    a_obs[i] = (F_ext_obs[i] - F_int_obs[i] - DAMPING_FACTOR * v_obs[i] * m_eff_o) / m_eff_o

            v_blade += a_blade * TIME_STEP_PHYSIQUE
            v_obs += a_obs * TIME_STEP_PHYSIQUE
            
            for idx in fixed_blade_nodes:
                if 2*idx + 1 < len(v_blade): 
                    v_blade[2*idx] = 0.0 ; v_blade[2*idx + 1] = 0.0
            for idx in fixed_obs_nodes:
                if 2*idx + 1 < len(v_obs):
                    v_obs[2*idx] = 0.0 ; v_obs[2*idx + 1] = 0.0

            u_blade += v_blade * TIME_STEP_PHYSIQUE
            u_obs += v_obs * TIME_STEP_PHYSIQUE

            # 5. Érosion
            class SurvivingElement:
                def __init__(self, nodes):
                    self.nodes = nodes

            eroded_b, eroded_o = False, False

            if M_blade is not None and len(blade_elements_data) > 0:
                blade_elements_data, _, _, _, _, eroded_b = \
                    FractureManager.process_erosion_vectorized(
                        blade_elements_data, sigma_blade, blade_ddls, blade_B, blade_D, blade_vol
                    )
                    
            if M_obstacle is not None and len(obstacle_elements_data) > 0:
                obstacle_elements_data, _, _, _, _, eroded_o = \
                    FractureManager.process_erosion_vectorized(
                        obstacle_elements_data, sigma_obs, obs_ddls, obs_B, obs_D, obs_vol
                    )

            if (eroded_b or eroded_o) and detector is not None:
                surviving_obs_objects = [SurvivingElement(el['nodes']) for el in obstacle_elements_data]
                surviving_blade_objects = [SurvivingElement(el['nodes']) for el in blade_elements_data]
                detector = CollisionDetector(initial_obs_nodes, surviving_obs_objects)
                detector.blade_elements = surviving_blade_objects

        # --- FIN DE LA BOUCLE INTERNE (Fin d'une frame) ---
        
        # Enregistrement du stress maximal de la frame
        if len(sigma_blade) > 0:
            sig_x = sigma_blade[:, 0]
            sig_y = sigma_blade[:, 1]
            tau_xy = sigma_blade[:, 2]
            von_mises = np.sqrt(sig_x**2 + sig_y**2 - sig_x*sig_y + 3 * tau_xy**2)
            max_stress_frame = float(np.max(von_mises))
        
        # Enregistrement dans la liste des résultats
        results.append({
            "Frame": frame_id,
            "Max_U_Blade": float(np.max(np.abs(u_blade))) if len(u_blade) > 0 else 0.0,
            "Max_Stress_Blade": max_stress_frame,
            "Max_U_Obs": float(np.max(np.abs(u_obs))) if len(u_obs) > 0 else 0.0,
            "Blade_Elements_Left": len(blade_elements_data),
            "Wood_Elements_Left": len(obstacle_elements_data)
        })

    return results

def main():
# 1. Définition de l'espace vectoriel des paramètres
    param_space = {
        "penalty_stiffness": [2.0e7, 5.0e7, 1.0e8],
        "damping_factor": [15.0, 50.0],
        "contact_damping": [3000.0, 8000.0],
        
        "steel_E": [20.5e9],
        "steel_nu": [0.28],
        "steel_sigma_yield": [2.5e8, 2.5e10], # Acier standard vs Acier indéformable
        "steel_limit_strain": [5.0],
        
        "wood_E": [1.2e9],
        "wood_nu": [0.26],
        "wood_sigma_uts": [1.0e7, 4.0e7],     # Bois fragilisé vs Bois standard
        "wood_limit_strain": [0.15, 0.05]     # Déchirure standard vs Déchirure rapide
    }

    # 2. Génération du produit cartésien (toutes les combinaisons)
    keys = param_space.keys()
    values = param_space.values()
    combinations = list(itertools.product(*values))

    test_cases = []
    for test_id, combo in enumerate(combinations, start=1):
        case = {"test_id": test_id}
        case.update(dict(zip(keys, combo)))
        test_cases.append(case)

   

    json_input = "lamesim/save/lancé_couteau_augmente.json"
    csv_output = "lamesim/save/simulation_batch_results.csv"

    print(f"Génération de {len(test_cases)} configurations de test.")

    # 3. Écriture de l'en-tête dynamique
    headers = ["Test_ID"] + list(keys) + ["Frame", "Max_U_Blade", "Max_Stress", "Max_U_Obs", "Blade_Elem", "Wood_Elem"]
    
    with open(csv_output, 'w', newline='') as f:
        writer = csv.writer(f)
        writer.writerow(headers)

        for params in tqdm(test_cases, desc="Analyse paramétrique", unit="test"):
            
            # Appel du solveur (à modifier pour accepter le dictionnaire complet)
            frame_results = run_headless_simulation(json_input, params, frames=15)
            
            for res in frame_results:
                # Extraction ordonnée des valeurs de paramètres
                param_values = [params[k] for k in keys]
                
                row = [params["test_id"]] + param_values + [
                    res["Frame"], res["Max_U_Blade"], res["Max_Stress_Blade"], 
                    res["Max_U_Obs"], res["Blade_Elements_Left"], res["Wood_Elements_Left"]
                ]
                writer.writerow(row)

if __name__ == "__main__":
    main()