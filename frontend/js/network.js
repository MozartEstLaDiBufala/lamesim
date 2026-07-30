import { blade, obstacle, appState, simulationState } from './state.js';
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
    statusIndicator.textContent = "● Connecté";
    const btnSim = document.getElementById("btn-sim");
    if (btnSim) btnSim.disabled = false;
  };

  wsConnection.onclose = () => {
    statusIndicator.textContent = "● Déconnecté";
    const btnSim = document.getElementById("btn-sim");
    if (btnSim) btnSim.disabled = true;
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