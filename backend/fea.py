# FINITE ELEMENT ANALYSIS
import numpy as np
from backend.config_p import settings

MATERIALS = settings.get("materials", {})
print(f"MATERIALS.get('steel').get('E') : {MATERIALS.get('steel').get('E')} (Type: {type(MATERIALS.get('steel').get('E'))})")
print(f"MATERIALS.get('steel').get('nu') : {MATERIALS.get('steel').get('nu')} (Type: {type(MATERIALS.get('steel').get('nu'))})")
print(f"MATERIALS.get('steel').get('rho') : {MATERIALS.get('steel').get('rho')} (Type: {type(MATERIALS.get('steel').get('rho'))})")
print(f"MATERIALS.get('steel').get('sigma_yield') : {MATERIALS.get('steel').get('sigma_yield')} (Type: {type(MATERIALS.get('steel').get('sigma_yield'))})")
print(f"MATERIALS.get('steel').get('limit_strain') : {MATERIALS.get('steel').get('limit_strain')} (Type: {type(MATERIALS.get('steel').get('limit_strain'))})")

print(f"MATERIALS.get('wood').get('E') : {MATERIALS.get('wood').get('E')} (Type: {type(MATERIALS.get('wood').get('E'))})")
print(f"MATERIALS.get('wood').get('nu') : {MATERIALS.get('wood').get('E')} (Type: {type(MATERIALS.get('wood').get('E'))})")
print(f"MATERIALS.get('wood').get('rho') : {MATERIALS.get('wood').get('rho')} (Type: {type(MATERIALS.get('wood').get('rho'))})")
print(f"MATERIALS.get('wood').get('sigma_uts') : {MATERIALS.get('wood').get('sigma_uts')} (Type: {type(MATERIALS.get('wood').get('sigma_uts'))})")
print(f"MATERIALS.get('wood').get('limit_strain') : {MATERIALS.get('wood').get('limit_strain')} (Type: {type(MATERIALS.get('wood').get('limit_strain'))})")

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
    def precompute_properties(p1, p2, p3, t_px, material_name, scale_factor=0.001):
        """
        Pré-calcule les matrices invariables B et D d'un élément triangulaire.
        Effectue la conversion immédiate des pixels en mètres.
        """
        # 1. Extraction et conversion immédiate en mètres
        x1, y1 = p1['x'] * scale_factor, p1['y'] * scale_factor
        x2, y2 = p2['x'] * scale_factor, p2['y'] * scale_factor
        x3, y3 = p3['x'] * scale_factor, p3['y'] * scale_factor
        t_m = t_px * scale_factor

        # 2. Calcul de l'aire géométrique (en m²)
        A = 0.5 * abs(x1*(y2 - y3) + x2*(y3 - y1) + x3*(y1 - y2))
        
        # Sécurité : ignorer les éléments de surface nulle
        if A < 1e-12:
            return None

        # 3. Matrice géométrique B (Déformation-Déplacement, en m^-1)
        B = (1.0 / (2.0 * A)) * np.array([
            [y2 - y3, 0,       y3 - y1, 0,       y1 - y2, 0      ],
            [0,       x3 - x2, 0,       x1 - x3, 0,       x2 - x1],
            [x3 - x2, y2 - y3, x1 - x3, y3 - y1, x2 - x1, y1 - y2]
        ])

        # 4. Matrice matérielle D
        mat = MATERIALS.get(material_name, MATERIALS["steel"]) 
        D = ElementCST.get_D_matrix(mat["E"], mat["nu"])

        # 5. Calcul de la masse locale (en kg)
        rho = mat["rho"]
        m_total = A * t_m * rho
        m_node = m_total / 3.0 

        return {
            'A': A,
            't': t_m,
            'B': B,
            'D': D,
            'm_node': m_node
        }

    @staticmethod
    def check_failure(sigma, material_name):
        """Vérifie si l'élément a atteint son point de rupture."""
        mat = MATERIALS.get(material_name, MATERIALS["steel"])
        sig_x, sig_y, tau_xy = sigma[0], sigma[1], sigma[2]
        
        if material_name == "steel":
            # Critère de Von Mises pour matériaux ductiles
            von_mises = np.sqrt(sig_x**2 + sig_y**2 - sig_x*sig_y + 3 * tau_xy**2)
            limit = mat.get("sigma_yield", 2.5e8) # Limite par défaut : 250 MPa
            return von_mises >= limit
            
        elif material_name == "wood":
            # Critère de la contrainte principale maximale (Rankine) pour matériaux fragiles
            # Contrainte de traction maximale (sigma_1)
            sigma_1 = (sig_x + sig_y) / 2.0 + np.sqrt(((sig_x - sig_y) / 2.0)**2 + tau_xy**2)
            limit = mat.get("sigma_uts", 4.0e7) # Limite par défaut : 40 MPa
            # Le bois ne cède qu'en traction (sigma_1 positive)
            return sigma_1 >= limit and sigma_1 > 0 
            
        return False

    


class SystemAssembler:
    """Classe chargée de préparer le maillage pour l'intégration temporelle."""
    
    @staticmethod
    def precompute_system(nodes_dict_list, elements, scale_factor=0.001):
        """
        Retourne une liste contenant les propriétés pré-calculées de chaque élément,
        ainsi que le vecteur de masse globale M.
        """
        num_nodes = len(nodes_dict_list)
        M_global = np.zeros(2 * num_nodes)
        
        elements_data = []

        for el in elements:
            n1, n2, n3 = el.nodes[0], el.nodes[1], el.nodes[2]
            p1, p2, p3 = nodes_dict_list[n1], nodes_dict_list[n2], nodes_dict_list[n3]
            
            t_px = p1.get('t', 1.0)
            mat_name = getattr(el, 'material', 'steel')
            
            # Pré-calcul des propriétés physiques et géométriques
            props = ElementCST.precompute_properties(p1, p2, p3, t_px, mat_name, scale_factor)
            
            if props is None:
                continue
                
            # Tableau des Degrés De Liberté (DDL)
            ddls = [
                2*n1, 2*n1+1,
                2*n2, 2*n2+1,
                2*n3, 2*n3+1
            ]
            
            # Sauvegarde des données nécessaires au calcul de F_int
            elements_data.append({
                'nodes': [n1, n2, n3],
                'ddls': ddls,
                'B': props['B'],
                'D': props['D'],
                'A': props['A'],
                't': props['t'],
                'material': mat_name
            })
            
            # Assemblage dynamique du vecteur de masse modale
            for i in range(6):
                M_global[ddls[i]] += props['m_node']
                
        return elements_data, M_global