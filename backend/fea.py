#FINIT ELEMENT ANALYSIS
import numpy as np
from scipy.sparse import lil_matrix
from backend.config_p import settings

MATERIALS = settings.get("materials", {})

class ElementCST:
    """Classe gérant la physique d'un élément triangulaire CST 2D."""
    
    @staticmethod
    def get_D_matrix(E, nu):
        """Calcule la matrice de comportement D pour des contraintes planes."""
        coef = E / (1 - nu**2)
        D = np.array([
            [1,  nu, 0],
            [nu, 1,  0],
            [0,  0,  (1 - nu) / 2]
        ])
        return coef * D

    @staticmethod
    def compute_stiffness_matrix(p1, p2, p3, t, material_name):
        """
        Calcule la matrice de rigidité locale (6x6) d'un triangle.
        p1, p2, p3 : Dictionnaires avec {'x': float, 'y': float}
        """
        # 1. Extraction des coordonnées
        x1, y1 = p1['x'], p1['y']
        x2, y2 = p2['x'], p2['y']
        x3, y3 = p3['x'], p3['y']

        # 2. Calcul de l'aire géométrique du triangle
        A = 0.5 * abs(x1*(y2 - y3) + x2*(y3 - y1) + x3*(y1 - y2))
        
        # Sécurité pour éviter les divisions par zéro si le triangle est plat
        if A < 1e-10:
            return np.zeros((6, 6)), 0.0

        # 3. Matrice B (Déformation-Déplacement)
        B = (1.0 / (2.0 * A)) * np.array([
            [y2 - y3, 0,       y3 - y1, 0,       y1 - y2, 0      ],
            [0,       x3 - x2, 0,       x1 - x3, 0,       x2 - x1],
            [x3 - x2, y2 - y3, x1 - x3, y3 - y1, x2 - x1, y1 - y2]
        ])

        # 4. Matrice D (Matériau)
        mat = MATERIALS.get(material_name, MATERIALS["steel"])
        D = ElementCST.get_D_matrix(mat["E"], mat["nu"])

        # 5. Calcul matriciel final : Ke = t * A * B^T * D * B
        Ke = t * A * np.dot(B.T, np.dot(D, B))
        
        return Ke, A

class SystemAssembler:
    @staticmethod
    def assemble(nodes_dict_list, elements, scale_factor=0.001):
        """
        Assemble la matrice de rigidité globale K et le vecteur de masse globale M.
        L'intégration du scale_factor (0.001 par défaut) convertit les pixels en mètres.
        """
        num_nodes = len(nodes_dict_list)
        K_global = lil_matrix((2 * num_nodes, 2 * num_nodes))
        M_global = np.zeros(2 * num_nodes) 

        for el in elements:
            n1, n2, n3 = el.nodes[0], el.nodes[1], el.nodes[2]
            p1, p2, p3 = nodes_dict_list[n1], nodes_dict_list[n2], nodes_dict_list[n3]
            
            t = p1.get('t', 1.0)
            mat_name = getattr(el, 'material', 'steel')
            
            # Calcul de Ke local avec les dimensions brutes (en pixels)
            Ke, Area_px = ElementCST.compute_stiffness_matrix(p1, p2, p3, t, mat_name)
            if Area_px < 1e-10:
                continue
                
            # --- CORRECTION PHYSIQUE DES UNITÉS ---
            # 1. Conversion de la matrice de rigidité : 
            # Mathématiquement, K dépend linéairement de l'échelle spatiale.
            Ke_corrected = Ke * scale_factor

            # 2. Conversion de la géométrie en mètres pour la masse
            area_m2 = Area_px * (scale_factor ** 2)
            t_m = t * scale_factor
            
            # Calcul de la masse réelle du triangle (en kg)
            rho = MATERIALS.get(mat_name, MATERIALS["steel"])["rho"]
            m_total = area_m2 * t_m * rho
            m_node = m_total / 3.0 
            
            ddls = [
                2*n1, 2*n1+1,
                2*n2, 2*n2+1,
                2*n3, 2*n3+1
            ]
            
            # Assemblage avec les valeurs physiquement correctes
            for i in range(6):
                for j in range(6):
                    K_global[ddls[i], ddls[j]] += Ke_corrected[i, j]
            
            for i in range(6):
                M_global[ddls[i]] += m_node
                
        return K_global.tocsr(), M_global