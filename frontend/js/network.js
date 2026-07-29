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

  const payload = {
    blade: {
      mesh: { vertices: blade.mesh.vertices.map(v => ({ x: v.x, y: v.y })), elements: blade.mesh.elements },
      boundary_conditions: { fixed_nodes: fixedNodesIndices },
      kinematics: { velocity: blade.kinematics.velocity }
    },
    obstacle: {
      mesh: { vertices: obstacle.mesh.vertices.map(v => ({ x: v.x, y: v.y })), elements: obstacle.mesh.elements }
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