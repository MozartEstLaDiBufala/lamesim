import asyncio
import json
import math
from fastapi import FastAPI, WebSocket
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

app = FastAPI(title="BladeSim API - Streaming Edition")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- 1. Conservation de vos structures de données (Pydantic) ---
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
    # On autorise un dictionnaire générique pour l'obstacle en attendant son modèle Pydantic strict
    obstacle: dict | None = None 

# --- 2. Le point de terminaison asynchrone (WebSocket) ---
@app.websocket("/stream")
async def simulation_stream(websocket: WebSocket):
    await websocket.accept()
    print("Connexion WebSocket établie. En attente des données géométriques...")
    
    try:
        # A. Réception et validation stricte du premier message (La géométrie)
        data_text = await websocket.receive_text()
        raw_data = json.loads(data_text)
        payload = SimulationPayload(**raw_data) # Validation via Pydantic
        
        blade = payload.blade
        original_vertices = blade.mesh.vertices
        triangles = blade.mesh.triangles
        vel = blade.kinematics.velocity
        
        # B. Paramètres initiaux
        force_magnitude = math.hypot(vel.endX - vel.startX, vel.endY - vel.startY)
        impact_x = vel.endX
        impact_y = vel.endY
        
        print("Données validées. Lancement du solveur PoC...")

        # C. Boucle de calcul temporel (Le streaming)
        TOTAL_FRAMES = 50
        for frame_id in range(TOTAL_FRAMES):
            
            stresses = []
            current_vertices = []
            
            # Simulation d'un léger déplacement (ex: la lame descend de 2 pixels par frame)
            # Dans un vrai solveur, cela dépendra de la matrice de rigidité
            y_displacement = frame_id * 2.0 
            
            for pt in original_vertices:
                current_vertices.append({"x": pt.x, "y": pt.y + y_displacement})
            
            # Application de VOTRE algorithme mathématique sur les triangles déplacés
            for tri in triangles:
                p0, p1, p2 = current_vertices[tri[0]], current_vertices[tri[1]], current_vertices[tri[2]]
                cx = (p0["x"] + p1["x"] + p2["x"]) / 3.0
                cy = (p0["y"] + p1["y"] + p2["y"]) / 3.0
                
                distance = math.hypot(cx - impact_x, cy - (impact_y + y_displacement))
                normalized_distance = distance / 10.0 
                
                # σ = F / (d^2 + 1)
                sigma = force_magnitude / ((normalized_distance ** 2) + 1)
                stresses.append(sigma)
            
            # Construction de la frame selon l'architecture définie précédemment
            frame_payload = {
                "frame_id": frame_id,
                "sim_time_sec": frame_id * 0.001,
                "blade_displacement_cm": frame_id * 0.1,
                "data": {
                    "blade": {
                        "vertices": current_vertices,
                        "peak_stresses": stresses
                    },
                    "obstacle": {
                        "vertices": [],
                        "peak_stresses": []
                    }
                }
            }
            
            # Envoi binaire/texte au navigateur
            await websocket.send_text(json.dumps(frame_payload))
            await asyncio.sleep(0.05) # Temporisation pour simuler la charge de calcul
            
    except Exception as e:
        print(f"Erreur ou déconnexion : {e}")