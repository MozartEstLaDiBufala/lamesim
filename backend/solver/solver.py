import numpy as np

def compute_cst_stiffness(p1, p2, p3, E, nu, thickness):
    """
    Calcule la matrice de rigidité locale 6x6 pour un élément triangulaire (CST).
    Hypothèse : État de contrainte plane.
    
    Arguments:
    p1, p2, p3 : tuples ou listes contenant les coordonnées (x, y) des nœuds.
    E : Module de Young (Pa).
    nu : Coefficient de Poisson (sans dimension).
    thickness : Épaisseur de l'élément (m).
    
    Retourne:
    k_e : ndarray 6x6 (Matrice de rigidité locale de l'élément).
    """
    x1, y1 = p1
    x2, y2 = p2
    x3, y3 = p3
    
    # 1. Calcul de l'aire du triangle (Déterminant de la matrice jacobienne)
    det_J = (x2 - x1) * (y3 - y1) - (x3 - x1) * (y2 - y1)
    area = abs(det_J) / 2.0
    
    # Vérification de la dégénérescence géométrique
    if area < 1e-12:
        raise ValueError("Triangle dégénéré détecté (Aire quasi-nulle).")
        
    # 2. Coefficients géométriques pour la matrice B
    b1 = y2 - y3
    b2 = y3 - y1
    b3 = y1 - y2
    
    c1 = x3 - x2
    c2 = x1 - x3
    c3 = x2 - x1
    
    # 3. Assemblage de la matrice déformation-déplacement [B] (3x6)
    B = (1.0 / (2.0 * area)) * np.array([
        [b1,  0, b2,  0, b3,  0],
        [ 0, c1,  0, c2,  0, c3],
        [c1, b1, c2, b2, c3, b3]
    ])
    
    # 4. Assemblage de la matrice de comportement matériel [D] (3x3) - Contrainte plane
    factor = E / (1.0 - nu**2)
    D = factor * np.array([
        [1.0,  nu, 0.0],
        [ nu, 1.0, 0.0],
        [0.0, 0.0, (1.0 - nu) / 2.0]
    ])
    
    # 5. Calcul de la matrice de rigidité locale [k_e] (6x6)
    # k_e = t * A * (B^T * D * B)
    k_e = thickness * area * (B.T @ D @ B)
    
    return k_e