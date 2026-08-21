import numpy as np
from backend.fea import ElementCST

class FractureManager:
    """Gère la séparation nodale et la redéfinition topologique lors de la rupture."""
    
    @staticmethod
    def process_fracture(elements_data, u, v, a, M, material_name):
        """
        Analyse les contraintes et détache un nœud de l'élément si la limite est franchie.
        Redimensionne les vecteurs cinématiques et met à jour la connectivité.
        """
        has_fractured = False
        new_u, new_v, new_a, new_M = [], [], [], []
        
        # Le nombre de nœuds actuels est déduit de la taille du vecteur u
        current_num_nodes = len(u) // 2 
        new_nodes_count = 0
        
        for el in elements_data:
            ddls = el['ddls']
            
            # Extraction cinématique et calcul de la contrainte
            u_e = u[ddls]
            epsilon = np.dot(el['B'], u_e)
            sigma = np.dot(el['D'], epsilon)
            
            # Vérification via le critère défini dans ElementCST (fea.py)
            if ElementCST.check_failure(sigma, material_name):
                
                # 1. Sélection du nœud à dédoubler (Détachement de l'élément)
                # On choisit arbitrairement le premier nœud de l'élément pour initier la faille
                node_to_split = el['nodes'][0]
                new_node_idx = current_num_nodes + new_nodes_count
                
                # 2. Copie de l'état cinématique (Conservation de la vitesse/position)
                new_u.extend([u[2*node_to_split], u[2*node_to_split + 1]])
                new_v.extend([v[2*node_to_split], v[2*node_to_split + 1]])
                new_a.extend([a[2*node_to_split], a[2*node_to_split + 1]])
                
                # 3. Répartition de l'inertie (Conservation de la masse totale)
                # La masse du nœud partagé est divisée par deux pour éviter la création de matière
                m_val = M[2*node_to_split]
                half_mass = m_val / 2.0
                
                M[2*node_to_split] = half_mass
                M[2*node_to_split + 1] = half_mass
                new_M.extend([half_mass, half_mass])
                
                # 4. Mise à jour de la topologie de l'élément (Connectivité)
                el['nodes'][0] = new_node_idx
                el['ddls'][0] = 2 * new_node_idx
                el['ddls'][1] = 2 * new_node_idx + 1
                
                new_nodes_count += 1
                has_fractured = True

        # 5. Redimensionnement matriciel global (Exécuté une seule fois par sous-étape)
        if has_fractured:
            u = np.concatenate((u, new_u))
            v = np.concatenate((v, new_v))
            a = np.concatenate((a, new_a))
            M = np.concatenate((M, new_M))
            
        return elements_data, u, v, a, M, has_fractured