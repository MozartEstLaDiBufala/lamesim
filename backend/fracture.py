import numpy as np
from backend.fea import ElementCST
from backend.config_p import settings

MATERIALS = settings.get("materials", {})

class FractureManager:
    @staticmethod
    def process_fracture_vectorized(elements_data, u, v, a, M, sigma_tensor, ddls_tensor, fractured_mask, material_name):
        mat = MATERIALS.get(material_name, MATERIALS.get("steel"))
        
        sig_x = sigma_tensor[:, 0]
        sig_y = sigma_tensor[:, 1]
        tau_xy = sigma_tensor[:, 2]
        
        # 1. ÉVALUATION AVEC LE FILTRE (~fractured_mask ignore les triangles déjà cassés)
        if material_name == "steel":
            limit = mat.get("sigma_yield", 2.5e8)
            von_mises = np.sqrt(sig_x**2 + sig_y**2 - sig_x*sig_y + 3 * tau_xy**2)
            critical_indices = np.where((von_mises >= limit) & (~fractured_mask))[0]
            
        elif material_name == "wood":
            limit = mat.get("sigma_uts", 4.0e7)
            sigma_1 = (sig_x + sig_y) / 2.0 + np.sqrt(((sig_x - sig_y) / 2.0)**2 + tau_xy**2)
            critical_indices = np.where((sigma_1 >= limit) & (sigma_1 > 0) & (~fractured_mask))[0]
        else:
            critical_indices = np.array([])

        if len(critical_indices) == 0:
            return elements_data, u, v, a, M, ddls_tensor, fractured_mask, False, []

        # 2. TRAITEMENT TOPOLOGIQUE
        new_u, new_v, new_a, new_M = [], [], [], []
        split_parents = [] # On mémorise qui est le parent
        current_num_nodes = len(u) // 2 
        new_nodes_count = 0
        
        for idx in critical_indices:
            # MARQUAGE DE L'ÉLÉMENT COMME CASSÉ POUR ÉVITER LA BOUCLE INFINIE
            fractured_mask[idx] = True 
            
            el = elements_data[idx]
            node_to_split = el['nodes'][0]
            split_parents.append(node_to_split) # Enregistrement du parent

            new_node_idx = current_num_nodes + new_nodes_count
            
            new_u.extend([u[2*node_to_split], u[2*node_to_split + 1]])
            new_v.extend([v[2*node_to_split], v[2*node_to_split + 1]])
            new_a.extend([a[2*node_to_split], a[2*node_to_split + 1]])
            
            half_mass = M[2*node_to_split] / 2.0
            M[2*node_to_split] = half_mass
            M[2*node_to_split + 1] = half_mass
            new_M.extend([half_mass, half_mass])
            
            el['nodes'][0] = new_node_idx
            el['ddls'][0] = 2 * new_node_idx
            el['ddls'][1] = 2 * new_node_idx + 1
            
            ddls_tensor[idx, 0] = 2 * new_node_idx
            ddls_tensor[idx, 1] = 2 * new_node_idx + 1
            
            new_nodes_count += 1

        u = np.concatenate((u, new_u))
        v = np.concatenate((v, new_v))
        a = np.concatenate((a, new_a))
        M = np.concatenate((M, new_M))
            
        return elements_data, u, v, a, M, ddls_tensor, fractured_mask, True, split_parents