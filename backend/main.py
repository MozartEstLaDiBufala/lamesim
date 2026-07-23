import asyncio
import json
import math
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
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

# --- 1. Mise à jour des structures de données (Pydantic) ---
class Point(BaseModel):
    x: float
    y: float

class Velocity(BaseModel):
    startX: float
    startY: float
    endX: float
    endY: float

# NOUVEAU : Modèle pour les éléments avec matériaux
class Element(BaseModel):
    nodes: list[int]
    material: str

class Mesh(BaseModel):
    vertices: list[Point]
    elements: list[Element] # Remplace l'ancien attribut "triangles"

class Kinematics(BaseModel):
    velocity: Velocity

class Blade(BaseModel):
    mesh: Mesh
    kinematics: Kinematics

class SimulationPayload(BaseModel):
    blade: Blade
    obstacle: dict | None = None 

# --- 2. Le point de terminaison asynchrone (WebSocket) ---
@app.websocket("/stream")
async def simulation_stream(websocket: WebSocket):
    # A. Le serveur accepte la connexion et garde la porte ouverte
    await websocket.accept()
    print("Connexion WebSocket établie. En attente des données...")
    
    try:
        # B. La boucle infinie : le serveur attend indéfiniment de nouvelles requêtes
        while True:
            # Le script "pause" ici jusqu'à ce que vous cliquiez sur "Envoyer"
            data_text = await websocket.receive_text()
            raw_data = json.loads(data_text)
            
            print("Données reçues. Validation Pydantic en cours...")
            payload = SimulationPayload(**raw_data) 
            
            blade = payload.blade
            original_vertices = blade.mesh.vertices
            elements = blade.mesh.elements # Extraction des nouveaux éléments
            vel = blade.kinematics.velocity
            
            # Paramètres initiaux
            force_magnitude = math.hypot(vel.endX - vel.startX, vel.endY - vel.startY)
            impact_x = vel.endX
            impact_y = vel.endY
            
            print(f"Calcul lancé. Maillage de {len(elements)} éléments.")

            # C. Boucle de calcul temporel (Le streaming)
            TOTAL_FRAMES = 50
            for frame_id in range(TOTAL_FRAMES):
                
                stresses = []
                current_vertices = []
                
                # Descente simulée
                y_displacement = frame_id * 2.0 
                
                for pt in original_vertices:
                    current_vertices.append({"x": pt.x, "y": pt.y + y_displacement})
                
                # Boucle sur les nouveaux éléments (qui contiennent le matériau)
                for el in elements:
                    tri = el.nodes # On extrait l'index des 3 points
                    p0, p1, p2 = current_vertices[tri[0]], current_vertices[tri[1]], current_vertices[tri[2]]
                    
                    cx = (p0["x"] + p1["x"] + p2["x"]) / 3.0
                    cy = (p0["y"] + p1["y"] + p2["y"]) / 3.0
                    
                    distance = math.hypot(cx - impact_x, cy - (impact_y + y_displacement))
                    normalized_distance = distance / 10.0 
                    
                    # Plus tard, le calcul de force intègrera "el.material" (Acier ou Bois)
                    sigma = force_magnitude / ((normalized_distance ** 2) + 1)
                    stresses.append(sigma)
                
                # Construction de la trame
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
                
                # Envoi au navigateur
                await websocket.send_text(json.dumps(frame_payload))
                await asyncio.sleep(0.05) 
                
            print("Simulation terminée. En attente d'une nouvelle requête...")

    except WebSocketDisconnect:
        # L'utilisateur a fermé la page ou rechargé le navigateur
        print("Déconnexion propre du client WebSocket.")
    except Exception as e:
        print(f"Erreur inattendue du solveur : {e}")