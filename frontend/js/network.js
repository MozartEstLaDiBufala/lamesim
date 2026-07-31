import { blade, obstacle, appState, simulationState, simulationParams } from './state.js';
import { isPointInRect } from './mathUtils.js';
import { redraw } from './render.js';

let wsConnection = null;

export function updateTimelineUI() {
  if (simulationState.buffer.length === 0) return;
  const frame = simulationState.buffer[simulationState.currentIndex];
  const ui = document.getElementById("sim-displacement");
  if (ui) ui.textContent = `${frame.blade_displacement_cm.toFixed(2)} cm`;
  redraw();
}

export async function runSimulation() {
  
  if (!blade.isClosed || blade.mesh.elements.length === 0) return alert("Géométrie invalide.");
  if (!wsConnection || wsConnection.readyState !== WebSocket.OPEN) return alert("Serveur déconnecté.");

  simulationState.buffer.length = 0; 
  simulationState.currentIndex = 0;
  
  const slider = document.getElementById("sim-slider");
  if (slider) { slider.value = 0; slider.max = 0; }

  const fixedNodesIndices = [];
  blade.mesh.vertices.forEach((v, index) => {
    if (blade.fixations.some(rect => isPointInRect(v.x, v.y, rect))) fixedNodesIndices.push(index);
  }); 

  // Extraction des indices des nœuds encastrés de l'obstacle
  const obstacleFixedNodesIndices = [];
  if (obstacle.mesh && obstacle.mesh.vertices && obstacle.fixations) {
    obstacle.mesh.vertices.forEach((v, index) => {
      if (obstacle.fixations.some(rect => isPointInRect(v.x, v.y, rect))) {
        obstacleFixedNodesIndices.push(index);
      }
    });
  }

  // Extraction du vecteur de direction (dx, dy)
  let dirX = 0, dirY = 0;
  if (blade.kinematics.velocity) {
    dirX = blade.kinematics.velocity.endX - blade.kinematics.velocity.startX;
    dirY = blade.kinematics.velocity.endY - blade.kinematics.velocity.startY;
  }

  const payload = {
    scale_factor: 0.001, // 1 pixel = 0.001 mètre
      parameters: {
        time_step: simulationParams.timeStep,
        num_steps: simulationParams.numSteps
      },
      blade: {
        mesh: { 
          vertices: blade.mesh.vertices.map(v => ({ x: v.x, y: v.y, t: v.t !== undefined ? v.t : 1.0 })), 
          elements: blade.mesh.elements 
        },
        boundary_conditions: { fixed_nodes: fixedNodesIndices },
        kinematics: { 
          // Envoi de la direction (vecteur brut) et de la norme (scalaire physique)
          direction_vector: { dx: dirX, dy: dirY },
          speed_magnitude: blade.kinematics.impactSpeed 
        }
      },
      obstacle: {
        mesh: { 
          vertices: obstacle.mesh.vertices.map(v => ({ x: v.x, y: v.y, t: v.t !== undefined ? v.t : 1.0 })), 
          elements: obstacle.mesh.elements 
        },
        boundary_conditions: { fixed_nodes: obstacleFixedNodesIndices }
      }
    };

  try {
    // Validation visuelle du payload dans la console avant l'envoi
    console.log("[Simulation] Préparation du payload :", payload);
    
    const jsonString = JSON.stringify(payload);
    console.log(`[Simulation] Taille du payload : ${jsonString.length} octets`);
    
    wsConnection.send(jsonString);
    console.log("[Simulation] Payload envoyé avec succès.");
  } catch (e) {
    console.error("[Simulation] Erreur lors de la sérialisation ou de l'envoi :", e);
  }


  wsConnection.send(JSON.stringify(payload));
  appState.mode = "simulation";
  redraw();
}

export function connectSimulationStream() {
  const statusIndicator = document.getElementById("ws-status");
  if (wsConnection && wsConnection.readyState === WebSocket.OPEN) return;

  statusIndicator.textContent = "● Connexion en cours...";
  wsConnection = new WebSocket("ws://localhost:8000/stream");

  wsConnection.onopen = () => {
    console.log("[WebSocket] Connexion établie avec le serveur.");
    statusIndicator.textContent = "● Connecté";
    const btnSim = document.getElementById("btn-sim");
    if (btnSim) btnSim.disabled = false;
  };

  wsConnection.onclose = () => {
    // Le code 1000 indique une fermeture normale. Tout le reste est une erreur.
    if (event.code === 1000) {
      console.log(`[WebSocket] Déconnexion propre. Code: ${event.code}`);
    } else {
      console.warn(`[WebSocket] Déconnexion anormale. Code: ${event.code}. Raison: ${event.reason || "Non spécifiée par le serveur"}`);
    }
    statusIndicator.textContent = "● Déconnecté";
    const btnSim = document.getElementById("btn-sim");
    if (btnSim) btnSim.disabled = true;
  };

  wsConnection.onerror = (error) => {
    console.error("[WebSocket] Erreur réseau détectée :", error);
  };

  wsConnection.onmessage = (event) => {
    simulationState.buffer.push(JSON.parse(event.data));
    const slider = document.getElementById("sim-slider");
    slider.disabled = false;
    slider.max = simulationState.buffer.length - 1;
    
    if (parseInt(slider.value) >= simulationState.buffer.length - 2) {
      slider.value = simulationState.buffer.length - 1;
      simulationState.currentIndex = simulationState.buffer.length - 1;
      updateTimelineUI();
    }
  };
}