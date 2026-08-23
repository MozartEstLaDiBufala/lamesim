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
            limit = mat.get("sigma_yield")
            von_mises = np.sqrt(sig_x**2 + sig_y**2 - sig_x*sig_y + 3 * tau_xy**2)
            critical_indices = np.where((von_mises >= limit) & (~fractured_mask))[0]
            
        elif material_name == "wood":
            limit = mat.get("sigma_uts")
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
    

    @staticmethod
    def process_erosion_vectorized(elements_data, sigma_tensor, ddls_tensor, B_tensor, D_tensor, vol_tensor, material_name):
        """
        Supprime les éléments ayant dépassé le seuil critique de pulvérisation.
        Retourne les tenseurs allégés contenant uniquement les éléments survivants.
        """
        mat = MATERIALS.get(material_name, MATERIALS.get("wood"))
        
        sig_x = sigma_tensor[:, 0]
        sig_y = sigma_tensor[:, 1]
        tau_xy = sigma_tensor[:, 2]
        
        # 1. ÉVALUATION DU SEUIL D'ÉROSION (Contrainte ET Étirement)
        if material_name == "wood":
            limit_stress = mat.get("sigma_uts")
            E = mat.get("E")
            
            # Paramètre de l'utilisateur : Limite d'étirement géométrique
            limit_strain = mat.get("limit_strain")
            
            sigma_1 = (sig_x + sig_y) / 2.0 + np.sqrt(((sig_x - sig_y) / 2.0)**2 + tau_xy**2)
            sigma_2 = (sig_x + sig_y) / 2.0 - np.sqrt(((sig_x - sig_y) / 2.0)**2 + tau_xy**2)
            
            max_stress = np.maximum(np.abs(sigma_1), np.abs(sigma_2))
            
            # Calcul de l'étirement (Strain) via la loi de Hooke
            max_strain = max_stress / E
            
            # L'élément est détruit s'il subit trop de pression OU s'il est trop étiré
            eroded_mask = (max_stress >= limit_stress) | (max_strain >= limit_strain)
            
        elif material_name == "steel":
            limit_stress = mat.get("sigma_yield")
            E = mat.get("E")
            limit_strain = mat.get("limit_strain")
            
            von_mises = np.sqrt(sig_x**2 + sig_y**2 - sig_x*sig_y + 3 * tau_xy**2)
            max_strain = von_mises / E
            
            eroded_mask = (von_mises >= limit_stress) | (max_strain >= limit_strain)
        else:
            eroded_mask = np.zeros(len(elements_data), dtype=bool)

        surviving_mask = ~eroded_mask
        has_eroded = np.any(eroded_mask)

        # Sortie immédiate si aucune matière n'est détruite
        if not has_eroded:
            return elements_data, ddls_tensor, B_tensor, D_tensor, vol_tensor, False

        # 2. FILTRAGE TENSORIEL (Suppression instantanée de la matière)
        new_elements_data = [el for i, el in enumerate(elements_data) if surviving_mask[i]]
        new_ddls = ddls_tensor[surviving_mask]
        new_B = B_tensor[surviving_mask]
        new_D = D_tensor[surviving_mask]
        new_vol = vol_tensor[surviving_mask]
            
        return new_elements_data, new_ddls, new_B, new_D, new_vol, True