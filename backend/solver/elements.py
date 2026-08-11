import numpy as np
from scipy.sparse import coo_matrix
from solver import compute_cst_stiffness 

def assemble_global_stiffness(vertices, triangles, E, nu, thicknesses):
    """
    Assemble la matrice de rigidité globale [K] à partir des matrices locales.
    """
    num_nodes = len(vertices)
    num_elements = len(triangles)
    num_dofs = 2 * num_nodes
    
    # Pré-allocation des listes pour le stockage creux (Format COO)
    # row_indices et col_indices stockent les coordonnées de la valeur dans la matrice globale
    row_indices = []
    col_indices = []
    data_values = []
    
    for elem_idx in range(num_elements):
        # Extraction des index des nœuds composant le triangle
        n1, n2, n3 = triangles[elem_idx]
        
        p1 = (vertices[n1]["x"], vertices[n1]["y"])
        p2 = (vertices[n2]["x"], vertices[n2]["y"])
        p3 = (vertices[n3]["x"], vertices[n3]["y"])
        
        # Épaisseur extraite individuellement pour supporter le modèle 2.5D
        t_e = thicknesses[elem_idx]
        
        # Appel de la fonction définie précédemment pour obtenir la matrice 6x6 locale
        k_e = compute_cst_stiffness(p1, p2, p3, E, nu, t_e)
        
        # Cartographie des DDL : [u_x1, u_y1, u_x2, u_y2, u_x3, u_y3]
        global_dofs = [
            2 * n1, 2 * n1 + 1,
            2 * n2, 2 * n2 + 1,
            2 * n3, 2 * n3 + 1
        ]
        
        # Injection de la matrice locale dans les vecteurs globaux
        for i in range(6):
            for j in range(6):
                row_indices.append(global_dofs[i])
                col_indices.append(global_dofs[j])
                data_values.append(k_e[i, j])
                
    # Création de la matrice creuse. 
    # Note : coo_matrix additionne automatiquement les valeurs partageant les mêmes indices (row, col).
    K_global_coo = coo_matrix(
        (data_values, (row_indices, col_indices)), 
        shape=(num_dofs, num_dofs)
    )
    
    # Le format CSR est requis par les solveurs linéaires (spsolve) pour l'inversion
    return K_global_coo.tocsr()