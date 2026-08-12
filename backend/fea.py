#FINIT ELEMENT ANALYSIS
import numpy as np
from scipy.sparse import lil_matrix

# Base de données des propriétés physiques
MATERIALS = {
    "steel": {
        "E": 5e6,         # Module de Young en Pascals Réduit de 200 GPa à 5 MPa pour la stabilité numérique       
        "nu": 0.3,        # Coefficient de Poisson (sans unité)
        "rho": 7850       # Densité en kg/m³
    },
    "wood": {
        "E": 1e5,        # Module de Young pour le bois (10 GPa) reduit egalement
        "nu": 0.4,
        "rho": 600
    }
}

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
    def assemble(nodes_dict_list, elements):
        """
        Assemble la matrice de rigidité globale K et le vecteur de masse globale M.
        nodes_dict_list : Liste de dictionnaires [{'x': float, 'y': float, 't': float}]
        elements : Liste d'objets (Pydantic ou dictionnaires) contenant 'nodes' et 'material'
        """
        num_nodes = len(nodes_dict_list)
        
        # K_global : Matrice creuse (2N x 2N) pour économiser la mémoire
        K_global = lil_matrix((2 * num_nodes, 2 * num_nodes))
        
        # M_global : Vecteur de masse concentrée (2N)
        M_global = np.zeros(2 * num_nodes) 

        for el in elements:
            # Extraction des indices et des nœuds
            n1, n2, n3 = el.nodes[0], el.nodes[1], el.nodes[2]
            p1, p2, p3 = nodes_dict_list[n1], nodes_dict_list[n2], nodes_dict_list[n3]
            
            # Épaisseur et Matériau
            t = p1.get('t', 1.0)
            mat_name = getattr(el, 'material', 'steel')
            
            # Calcul de Ke local (6x6)
            Ke, Area = ElementCST.compute_stiffness_matrix(p1, p2, p3, t, mat_name)
            if Area < 1e-10:
                continue
                
            # Calcul de la masse du triangle (Aire * Épaisseur * Densité)
            rho = MATERIALS.get(mat_name, MATERIALS["steel"])["rho"]
            m_total = Area * t * rho
            m_node = m_total / 3.0 # Répartition équitable sur les 3 sommets
            
            # Définition des 6 Degrés de Liberté globaux pour ce triangle
            # Le nœud i occupe les indices 2*i (pour X) et 2*i+1 (pour Y)
            ddls = [
                2*n1, 2*n1+1,
                2*n2, 2*n2+1,
                2*n3, 2*n3+1
            ]
            
            # Assemblage de K : On ajoute Ke aux bons emplacements dans K_global
            for i in range(6):
                for j in range(6):
                    K_global[ddls[i], ddls[j]] += Ke[i, j]
            
            # Assemblage de M : On ajoute la masse modale aux DDLs X et Y
            for i in range(6):
                M_global[ddls[i]] += m_node
                
        # On convertit en format CSR (Compressed Sparse Row) pour des calculs ultra-rapides plus tard
        return K_global.tocsr(), M_global