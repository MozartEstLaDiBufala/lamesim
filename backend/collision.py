class CollisionDetector:
    def __init__(self, obstacle_nodes, obstacle_elements):
        """
        Initialise le détecteur avec la géométrie statique de l'obstacle.
        obstacle_nodes: Liste de dictionnaires ou d'objets avec x, y
        obstacle_elements: Liste des éléments (triangles) contenant les indices des nœuds
        """
        self.obstacle_nodes = obstacle_nodes
        self.obstacle_elements = obstacle_elements
        self.aabbs = self._compute_obstacle_aabbs()

    def _compute_obstacle_aabbs(self):
        """Calcule les boîtes englobantes (AABB) pour la Broad-Phase."""
        aabbs = []
        for el in self.obstacle_elements:
            tri_nodes = [self.obstacle_nodes[idx] for idx in el.nodes]
            min_x = min(n['x'] for n in tri_nodes)
            max_x = max(n['x'] for n in tri_nodes)
            min_y = min(n['y'] for n in tri_nodes)
            max_y = max(n['y'] for n in tri_nodes)
            aabbs.append((min_x, max_x, min_y, max_y))
        return aabbs

    def _sign(self, p1, p2, p3):
        """Fonction d'arête mathématique (produit vectoriel 2D)."""
        return (p1['x'] - p3['x']) * (p2['y'] - p3['y']) - (p2['x'] - p3['x']) * (p1['y'] - p3['y'])

    def _is_point_in_triangle(self, pt, p1, p2, p3):
        """Narrow-Phase : Détermine si un point est strictement dans un triangle."""
        d1 = self._sign(pt, p1, p2)
        d2 = self._sign(pt, p2, p3)
        d3 = self._sign(pt, p3, p1)

        has_neg = (d1 < 0) or (d2 < 0) or (d3 < 0)
        has_pos = (d1 > 0) or (d2 > 0) or (d3 > 0)

        # Si le point n'est pas à la fois d'un côté et de l'autre des arêtes, il est dedans
        return not (has_neg and has_pos)

    def detect_penetrations(self, current_blade_nodes):
        """
        Analyse les nœuds de la lame pour identifier les pénétrations dans l'obstacle.
        Retourne une liste de tuples : (index_noeud_lame, index_element_obstacle)
        """
        active_contacts = []
        
        for idx_node, node in enumerate(current_blade_nodes):
            nx, ny = node['x'], node['y']
            
            for idx_el, aabb in enumerate(self.aabbs):
                # Broad-Phase : Le point est-il dans l'AABB de cet élément ?
                if (aabb[0] <= nx <= aabb[1]) and (aabb[2] <= ny <= aabb[3]):
                    
                    # Narrow-Phase : Le point est-il dans le triangle ?
                    el = self.obstacle_elements[idx_el]
                    p1 = self.obstacle_nodes[el.nodes[0]]
                    p2 = self.obstacle_nodes[el.nodes[1]]
                    p3 = self.obstacle_nodes[el.nodes[2]]
                    
                    if self._is_point_in_triangle(node, p1, p2, p3):
                        active_contacts.append((idx_node, idx_el))
                        # Un nœud ne peut pénétrer qu'un seul élément à la fois à un instant T
                        break 
                        
        return active_contacts