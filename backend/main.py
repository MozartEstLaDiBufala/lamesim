from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import math

# Initialisation de l'API
app = FastAPI(title="BladeSim API")

# Configuration CORS (Indispensable pour autoriser le navigateur à communiquer avec le serveur local)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], # En production, il faudra spécifier l'URL exacte du frontend
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- Définition des structures de données (Schémas Pydantic) ---
# Ces classes doivent refléter exactement l'objet JSON envoyé par JavaScript
class Point(BaseModel):
    x: float
    y: float

class Velocity(BaseModel):
    startX: float
    startY: float
    endX: float
    endY: float

class Mesh(BaseModel):
    vertices: list[Point]
    triangles: list[list[int]]

class Kinematics(BaseModel):
    velocity: Velocity

class Blade(BaseModel):
    mesh: Mesh
    kinematics: Kinematics

class SimulationPayload(BaseModel):
    blade: Blade
    # L'obstacle sera ajouté ici ultérieurement

# --- Point de terminaison (Endpoint) de la simulation ---
@app.post("/api/simulate")
def solve_impact(payload: SimulationPayload):
    """
    Solveur PoC : Calcule une contrainte arbitraire basée sur la distance 
    entre chaque triangle et le point d'impact du vecteur vitesse.
    """
    blade = payload.blade
    vertices = blade.mesh.vertices
    triangles = blade.mesh.triangles
    vel = blade.kinematics.velocity
    
    # Le point d'impact est considéré comme la pointe de la flèche de vitesse
    impact_x = vel.endX
    impact_y = vel.endY
    
    # La norme du vecteur simule grossièrement la force (F)
    force_magnitude = math.hypot(vel.endX - vel.startX, vel.endY - vel.startY)
    
    stresses = []
    
    # Boucle sur chaque élément du maillage
    for tri in triangles:
        # 1. Calcul du barycentre du triangle
        p0, p1, p2 = vertices[tri[0]], vertices[tri[1]], vertices[tri[2]]
        cx = (p0.x + p1.x + p2.x) / 3.0
        cy = (p0.y + p1.y + p2.y) / 3.0
        
        # 2. Calcul de la distance géométrique (d) à l'impact
        distance = math.hypot(cx - impact_x, cy - impact_y)
        
        # 3. Application de la loi mathématique factice : σ = F / (d^2 + 1)
        # On divise la distance par 10 pour que l'atténuation soit visuellement intéressante sur le canvas
        normalized_distance = distance / 10.0 
        sigma = force_magnitude / ((normalized_distance ** 2) + 1)
        
        stresses.append(sigma)
        
    # Le serveur renvoie un objet JSON contenant le tableau des contraintes
    return {"stresses": stresses}