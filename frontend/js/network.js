import { blade, obstacle, appState, simulationState, simulationParams } from './state.js';
import { isPointInRect } from './mathUtils.js';
import { redraw } from './render.js';
import { refineMeshAdaptive } from './geometry.js';

let wsConnection = null;

export function updateTimelineUI() {

  if (simulationState.buffer.length === 0) return;

  const frame = simulationState.buffer[simulationState.currentIndex];
  const ui = document.getElementById("sim-displacement");

 if (ui && frame) {
    const totalSteps = typeof simulationParams !== 'undefined' ? simulationParams.numSteps : 50;
    ui.textContent = `Étape : ${frame.step} / ${totalSteps}`;
  }
  redraw();
}

export async function runSimulation() {
  
  if (!blade.isClosed || blade.mesh.elements.length === 0) {
    return alert("Lame invalide.")
   } else {
    refineMeshAdaptive(blade, 25);
   };
  if (!obstacle.isClosed || obstacle.mesh.elements.length === 0) {
    return alert("Obstacle invalide.")
   } else {
    refineMeshAdaptive(obstacle, 25);
   };
  
  redraw();
  
  if (!wsConnection || wsConnection.readyState !== WebSocket.OPEN) return alert("Serveur déconnecté.");

  const btnSim = document.getElementById("btn-sim");
  if (btnSim) {
    btnSim.disabled = true;
    btnSim.textContent = "Calcul en cours...";
  }

  const fixedNodesIndices = [];
  blade.mesh.vertices.forEach((v, index) => {
    if (blade.fixations.some(rect => isPointInRect(v.x, v.y, rect))) fixedNodesIndices.push(index);
  }); 

  blade.fixedNodes = fixedNodesIndices;

  // Extraction des indices des nœuds encastrés de l'obstacle
  const obstacleFixedNodesIndices = [];
  if (obstacle.mesh && obstacle.mesh.vertices && obstacle.fixations) {
    obstacle.mesh.vertices.forEach((v, index) => {
      if (obstacle.fixations.some(rect => isPointInRect(v.x, v.y, rect))) {
        obstacleFixedNodesIndices.push(index);
      }
    });
  }

  obstacle.fixedNodes = obstacleFixedNodesIndices;

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
      boundary_conditions: { 
        fixed_nodes: typeof fixedNodesIndices !== 'undefined' ? fixedNodesIndices : [] 
      },
      kinematics: { 
        // CORRECTION : On envoie l'objet velocity natif (qui contient startX, startY, endX, endY)
        velocity: blade.kinematics.velocity,
        impactSpeed: blade.kinematics.impactSpeed 
      }
    },
    obstacle: {
      mesh: { 
        vertices: obstacle.mesh.vertices.map(v => ({ x: v.x, y: v.y, t: v.t !== undefined ? v.t : 1.0 })), 
        elements: obstacle.mesh.elements 
      },
      boundary_conditions: { 
        fixed_nodes: typeof obstacleFixedNodesIndices !== 'undefined' ? obstacleFixedNodesIndices : [] 
      }
    }
  };

  try {
    // Validation visuelle du payload dans la console avant l'envoi
    console.log("[Simulation] Préparation du payload :", payload);
    
    // 1. Purge totale et propre de la mémoire temporelle
    simulationState.buffer.length = 0; 
    simulationState.currentIndex = 0;
    
    // 2. Réinitialisation du slider HTML
    const slider = document.getElementById("sim-slider");
    if (slider) {
      slider.value = 0;
      slider.max = 0;
    }

    const jsonString = JSON.stringify(payload);
    console.log(`[Simulation] Taille du payload : ${jsonString.length} octets`);
    wsConnection.send(jsonString);

    console.log("[Simulation] Payload envoyé avec succès.");
    appState.mode = "simulation";
    redraw();

  } catch (e) {
    console.error("[Simulation] Erreur lors de la sérialisation ou de l'envoi :", e);
  }
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

  wsConnection.onclose = (event) => {
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
    const frameData = JSON.parse(event.data);

    if (typeof simulationState !== 'undefined' && simulationState.buffer) {
      // 1. On stocke la trame
      simulationState.buffer.push(frameData);
      
      // 2. On pointe sur la dernière trame reçue
      simulationState.currentIndex = simulationState.buffer.length - 1;
      
      // 3. On redessine le canevas
      updateTimelineUI();
    }

    const slider = document.getElementById("sim-slider");
    if (slider) {
      slider.disabled = false;
      // 4. On ajuste la taille de la ligne de temps
      slider.max = simulationState.buffer.length - 1;
      // 5. NOUVEAU : On déplace le curseur visuellement pour suivre le live
      slider.value = simulationState.currentIndex; 
    }
    
    if (frameData.is_finished === true) {
      const btnSim = document.getElementById("btn-sim");
      if (btnSim) {
        btnSim.disabled = false;
        btnSim.textContent = "Envoie de la Simulation";
      }
    }
  };
}