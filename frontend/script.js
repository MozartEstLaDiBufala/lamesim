const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");

// --- Modèle de données factorisé ---
let blade = {
  type: "blade",
  contour: [],
  isClosed: false,
  mesh: { vertices: [], triangles: [] },
  physics: { centroid: { x: 0, y: 0 }, area: 0, mass: 1.0, stresses: [] },
  kinematics: { velocity: null }
};

let obstacle = {
  type: "obstacle",
  contour: [],
  isClosed: false,
  mesh: { vertices: [], triangles: [] },
  physics: { centroid: { x: 0, y: 0 }, area: 0, mass: 0 }
};

// --- 1. Structure de données globale ---
let scene = {
  parts: [],      // Contiendra les objets composant la hache (lame, manche)
  obstacle: { contour: [], isClosed: false }
};

// --- 2. Gestionnaire d'historique ---
const historyManager = {
  undoStack: [],
  redoStack: [],
  maxSize: 30 // Limite pour éviter la saturation de la mémoire vive
};

// Fonction de capture d'état
function saveState() {
  // On photographie explicitement les variables utilisées par votre code actuel
  const snapshot = structuredClone({ 
    blade: blade, 
    obstacle: obstacle 
  });
  
  historyManager.undoStack.push(snapshot);
  
  if (historyManager.undoStack.length > historyManager.maxSize) {
    historyManager.undoStack.shift();
  }
  
  historyManager.redoStack = [];
  updateHistoryUI();
}

// Fonction pour reculer dans le temps
function undo() {
  if (historyManager.undoStack.length === 0) return;
  
  // 1. Sauvegarde de l'état actuel pour le Redo
  historyManager.redoStack.push(structuredClone({ blade: blade, obstacle: obstacle }));
  
  // 2. Récupération de l'état passé
  const pastState = historyManager.undoStack.pop();
  
  // 3. Écrasement des variables globales par les données du passé
  blade = pastState.blade;
  obstacle = pastState.obstacle;
  
  updateHistoryUI();
  redraw(); // Met à jour le canevas avec les anciennes données
}

// Fonction pour avancer dans le temps
function redo() {
  if (historyManager.redoStack.length === 0) return;
  
  // 1. Sauvegarde pour le Undo
  historyManager.undoStack.push(structuredClone({ blade: blade, obstacle: obstacle }));
  
  // 2. Récupération de l'état futur
  const futureState = historyManager.redoStack.pop();
  
  // 3. Écrasement
  blade = futureState.blade;
  obstacle = futureState.obstacle;
  
  updateHistoryUI();
  redraw();
}

// Mise à jour de l'accessibilité des boutons
function updateHistoryUI() {
  const btnUndo = document.getElementById("btn-undo");
  const btnRedo = document.getElementById("btn-redo");
  
  if (btnUndo) btnUndo.disabled = historyManager.undoStack.length === 0;
  if (btnRedo) btnRedo.disabled = historyManager.redoStack.length === 0;
}

// Écouteurs pour les boutons HTML
document.getElementById("btn-undo")?.addEventListener("click", undo);
document.getElementById("btn-redo")?.addEventListener("click", redo);

// Support des raccourcis clavier standards
document.addEventListener("keydown", (e) => {
  if (e.ctrlKey && e.key === 'z') {
    e.preventDefault();
    undo();
  } else if ((e.ctrlKey && e.key === 'y') || (e.ctrlKey && e.shiftKey && e.key === 'Z')) {
    e.preventDefault();
    redo();
  }
});

// --- Événements Souris (Interaction Canvas) ---
canvas.addEventListener("mousedown", (e) => {
  const rect = canvas.getBoundingClientRect();
  const mx = e.clientX - rect.left;
  const my = e.clientY - rect.top;

  // 1. Interaction avec la flèche de vitesse (Uniquement si la lame est maillée)
  if (blade.isClosed && blade.kinematics.velocity) {
    const v = blade.kinematics.velocity;
    if (distance(mx, my, v.endX, v.endY) < 15) {
      appState.draggingVelocity = true;
      return; 
    }
  }

  // 2. Logique de tracé (Lame ou Bûche)
  if (appState.mode === "draw_blade" || appState.mode === "draw_obstacle") {
    const target = appState.mode === "draw_blade" ? blade : obstacle;
    
    if (!target.isClosed) {
      // ➔ PHOTO DE L'ÉTAT AVANT TOUTE MODIFICATION
      saveState();

      // Si on clique près du point de départ, on ferme la géométrie
      if (target.contour.length > 2 && distance(mx, my, target.contour[0].x, target.contour[0].y) < 15) {
        target.isClosed = true;
        generateMesh(target); // Le maillage calcule ses propres données
      } else {
        // Sinon, on ajoute un simple point
        target.contour.push({ x: mx, y: my });
      }
      
      redraw();
    }
  }
});


const appState = {
  mode: "draw_blade", // "draw_blade", "draw_obstacle", "simulation"
  showMeshLines: true,
  draggingVelocity: false
};

// --- Moteur de Simulation (Buffer Temporel) ---
const simulationBuffer = []; // Stockera toutes les frames JSON reçues
let currentFrameIndex = 0;   // Position actuelle de lecture sur la timeline
let wsConnection = null;     // L'instance de la connexion serveur

// --- Initialisation ---
function resizeCanvas() {
  const container = document.getElementById("canvas-container");
  if (!container) return;
  canvas.width = container.clientWidth;
  canvas.height = window.innerHeight * 0.85;
  redraw();
}

window.addEventListener("resize", resizeCanvas);
// Délai d'exécution pour garantir le chargement du DOM
setTimeout(resizeCanvas, 50); 

// --- Utilitaires mathématiques ---
function distance(x1, y1, x2, y2) {
  return Math.hypot(x2 - x1, y2 - y1);
}

function calculateCentroid(pointsArray) {
  if (pointsArray.length < 3) return { x: 0, y: 0, area: 0 };
  
  let area = 0;
  let cx = 0;
  let cy = 0;
  
  for (let i = 0; i < pointsArray.length; i++) {
    let j = (i + 1) % pointsArray.length;
    let factor = (pointsArray[i].x * pointsArray[j].y) - (pointsArray[j].x * pointsArray[i].y);
    area += factor;
    cx += (pointsArray[i].x + pointsArray[j].x) * factor;
    cy += (pointsArray[i].y + pointsArray[j].y) * factor;
  }
  
  area /= 2;
  cx /= (6 * area);
  cy /= (6 * area);
  
  return { x: cx, y: cy, area: Math.abs(area) };
}

// --- Synchronisation Cinématique ---
function syncVelocityInputs() {
  const v = blade.kinematics.velocity;
  if (!v) return;
  const vxInput = document.getElementById("input-vx");
  const vyInput = document.getElementById("input-vy");
  if (vxInput) vxInput.value = Math.round(v.endX - v.startX);
  if (vyInput) vyInput.value = Math.round(v.endY - v.startY);
}

function syncVelocityFromInputs() {
  const v = blade.kinematics.velocity;
  if (!v) return;
  const vx = parseFloat(document.getElementById("input-vx").value) || 0;
  const vy = parseFloat(document.getElementById("input-vy").value) || 0;
  v.endX = v.startX + vx;
  v.endY = v.startY + vy;
  redraw();
}

// --- Algorithme de Maillage et Physique ---
function generateMesh(target) {
  if (target.contour.length < 3) return;

  const flatCoords = [];
  target.contour.forEach(p => {
    flatCoords.push(p.x, p.y);
  });

  const trianglesIndices = earcut(flatCoords);
  target.mesh.vertices = [...target.contour];
  target.mesh.triangles = [];
  
  for (let i = 0; i < trianglesIndices.length; i += 3) {
    target.mesh.triangles.push([
      trianglesIndices[i],
      trianglesIndices[i+1],
      trianglesIndices[i+2]
    ]);
  }

  const centroidData = calculateCentroid(target.contour);
  target.physics.centroid = { x: centroidData.x, y: centroidData.y };
  target.physics.area = centroidData.area;

  // L'initialisation du vecteur cinématique est strictement réservée à la lame
  if (target.type === "blade") {
    target.kinematics.velocity = {
      startX: target.physics.centroid.x,
      startY: target.physics.centroid.y,
      endX: target.physics.centroid.x,
      endY: target.physics.centroid.y + 100 
    };
    syncVelocityInputs();
  }

  redraw();
}

// --- Événements Interface (Champs Numériques) ---
document.getElementById("input-vx")?.addEventListener("input", syncVelocityFromInputs);
document.getElementById("input-vy")?.addEventListener("input", syncVelocityFromInputs);


canvas.addEventListener("mousemove", e => {
  // 3. Logique de déplacement de la flèche
  if (appState.draggingVelocity && blade.kinematics.velocity) {
    const rect = canvas.getBoundingClientRect();
    blade.kinematics.velocity.endX = e.clientX - rect.left;
    blade.kinematics.velocity.endY = e.clientY - rect.top;
    syncVelocityInputs(); // Met à jour le panneau latéral en temps réel
    redraw();
  }
});

window.addEventListener("mouseup", () => {
  // 4. Relâchement de toute action de glissement
  appState.draggingVelocity = false;
});

// --- Événements Interface (Boutons) ---
document.getElementById("btn-draw-blade")?.addEventListener("click", () => { appState.mode = "draw_blade"; });
document.getElementById("btn-draw-obs")?.addEventListener("click", () => { appState.mode = "draw_obstacle"; });
document.getElementById("btn-toggle-mesh")?.addEventListener("click", () => {
  appState.showMeshLines = !appState.showMeshLines;
  redraw();
});
document.getElementById("btn-sim")?.addEventListener("click", runSimulation);

// --- Moteur de Rendu ---
function drawEntity(target) {
  // 1. Détermination de la source de données
  // Par défaut, on affiche ce que l'utilisateur est en train de tracer
  let contourToDraw = target.contour; 
  let meshVertices = target.mesh.vertices;
  let activeStresses = null;

  // Si on est en mode simulation ET qu'on a des données en mémoire, on écrase les coordonnées
  if (appState.mode === "simulation" && simulationBuffer.length > 0) {
    const frameData = simulationBuffer[currentFrameIndex].data[target.type];
    if (frameData && frameData.vertices && frameData.vertices.length > 0) {
      contourToDraw = frameData.vertices; // Déforme les contours
      meshVertices = frameData.vertices;  // Déforme le maillage interne
      activeStresses = frameData.peak_stresses;
    }
  }

  // 2. Dessin du périmètre (Utilise le tracé brut ou le tracé simulé)
  if (contourToDraw.length > 0) {
    ctx.strokeStyle = target.type === "blade" ? "#333" : "#004085";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(contourToDraw[0].x, contourToDraw[0].y);
    for (let i = 1; i < contourToDraw.length; i++) {
      ctx.lineTo(contourToDraw[i].x, contourToDraw[i].y);
    }
    if (target.isClosed) ctx.closePath();
    ctx.stroke();
    
    // Nœuds de contrôle (Visibles uniquement pendant le tracé, pas en simulation)
    if (!target.isClosed && appState.mode !== "simulation") {
      ctx.fillStyle = target.type === "blade" ? "blue" : "darkcyan";
      contourToDraw.forEach(p => {
        ctx.beginPath();
        ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
        ctx.fill();
      });
    }
  }

  // 3. Dessin du maillage et de la Heatmap
  if (target.isClosed && target.mesh.triangles.length > 0) {
    
    let maxStress = 0;
    if (activeStresses && activeStresses.length > 0) {
      maxStress = Math.max(...activeStresses);
    }

    target.mesh.triangles.forEach((tri, triIndex) => {
      let fillColor = target.type === "blade" ? "rgba(180, 180, 180, 0.7)" : "rgba(173, 216, 230, 0.7)";
      
      // Application de la couleur d'effort si la donnée existe
      if (activeStresses && activeStresses[triIndex] !== undefined) {
        fillColor = getStressColor(activeStresses[triIndex], maxStress, target.type);
      }
      
      ctx.fillStyle = fillColor;
      ctx.beginPath();
      
      // Utilisation des coordonnées sécurisées du maillage
      ctx.moveTo(meshVertices[tri[0]].x, meshVertices[tri[0]].y);
      ctx.lineTo(meshVertices[tri[1]].x, meshVertices[tri[1]].y);
      ctx.lineTo(meshVertices[tri[2]].x, meshVertices[tri[2]].y);
      ctx.closePath();
      ctx.fill(); 
      
      // Lignes de maillage conditionnelles
      if (appState.showMeshLines) {
        ctx.strokeStyle = target.type === "blade" ? "#999" : "#87CEFA";
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    });
  }
}

function redraw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Exécution du rendu pour les entités actives
  drawEntity(blade);
  drawEntity(obstacle);

  // 3. Dessin du vecteur de vitesse cinématique (spécifique à la lame)
  if (blade.isClosed && blade.kinematics.velocity) {
    const v = blade.kinematics.velocity;
    ctx.strokeStyle = "red";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(v.startX, v.startY);
    ctx.lineTo(v.endX, v.endY);
    ctx.stroke();

    const angle = Math.atan2(v.endY - v.startY, v.endX - v.startX);
    ctx.beginPath();
    ctx.moveTo(v.endX, v.endY);
    ctx.lineTo(v.endX - 15 * Math.cos(angle - Math.PI / 6), v.endY - 15 * Math.sin(angle - Math.PI / 6));
    ctx.lineTo(v.endX - 15 * Math.cos(angle + Math.PI / 6), v.endY - 15 * Math.sin(angle + Math.PI / 6));
    ctx.fillStyle = "red";
    ctx.fill();
  }

  updateDataPanel();
}

// --- Génération de l'interface des données ---
function generateEntityTable(entity, title) {
  if (entity.contour.length === 0) {
    return `
      <div style="margin-bottom: 15px;">
        <h4 style="margin: 0 0 5px 0; color: #333;">${title}</h4>
        <p style="font-size: 13px; color: #666;">Aucun point tracé.</p>
      </div>
    `;
  }

  let html = `
    <div style="margin-bottom: 15px;">
      <h4 style="margin: 0 0 5px 0; color: #333;">${title}</h4>
      <p style="font-size: 13px; margin: 2px 0;"><strong>Statut:</strong> ${entity.isClosed ? "Géométrie fermée" : "En cours de tracé"}</p>
      <p style="font-size: 13px; margin: 2px 0 10px 0;"><strong>Triangles:</strong> ${entity.mesh.triangles.length}</p>
      
      <table style="width: 100%; border-collapse: collapse; font-size: 13px; text-align: center;">
        <thead>
          <tr style="background-color: #e9ecef; border-bottom: 2px solid #ccc;">
            <th style="padding: 4px; border: 1px solid #ccc;">Nœud</th>
            <th style="padding: 4px; border: 1px solid #ccc;">X (px)</th>
            <th style="padding: 4px; border: 1px solid #ccc;">Y (px)</th>
          </tr>
        </thead>
        <tbody>
  `;

  entity.contour.forEach((p, index) => {
    html += `
          <tr>
            <td style="padding: 4px; border: 1px solid #eee;">n°${index}</td>
            <td style="padding: 4px; border: 1px solid #eee;">${Math.round(p.x)}</td>
            <td style="padding: 4px; border: 1px solid #eee;">${Math.round(p.y)}</td>
          </tr>`;
  });

  html += `
        </tbody>
      </table>
    </div>
  `;
  
  return html;
}

function updateDataPanel() {
  const dataContent = document.getElementById("data-content");
  if (!dataContent) return;

  // Concaténation des données des deux entités
  let finalHtml = generateEntityTable(blade, "Données de la Lame");
  
  // Ligne de séparation visuelle
  finalHtml += `<hr style="border: 0; border-top: 1px solid #ccc; margin: 15px 0;">`;
  
  finalHtml += generateEntityTable(obstacle, "Données de la Bûche");

  // Injection dans le DOM
  dataContent.innerHTML = finalHtml;
}

// --- Communication Client-Serveur (API) ---
async function runSimulation() {
  // Validation des prérequis géométriques
  if (!blade.isClosed || blade.mesh.triangles.length === 0) {
    alert("Erreur : La géométrie de la lame doit être fermée et maillée.");
    return;
  }

  // Construction stricte du payload JSON
  const payload = {
    blade: {
      mesh: {
        // Extraction des coordonnées pour éviter de transmettre des références circulaires ou données inutiles
        vertices: blade.mesh.vertices.map(v => ({ x: v.x, y: v.y })),
        triangles: blade.mesh.triangles
      },
      kinematics: {
        velocity: {
          startX: blade.kinematics.velocity.startX,
          startY: blade.kinematics.velocity.startY,
          endX: blade.kinematics.velocity.endX,
          endY: blade.kinematics.velocity.endY
        }
      }
    }
  };

  try {
    // Exécution de la requête asynchrone vers le serveur local
    const response = await fetch("http://127.0.0.1:8000/api/simulate", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    // Vérification du code de statut HTTP
    if (!response.ok) {
      throw new Error(`Code d'erreur HTTP : ${response.status}`);
    }

    // Désérialisation de la réponse JSON
    const data = await response.json();
    
    // Stockage des résultats dans le modèle de données
    blade.physics.stresses = data.stresses;
    console.log("Calculs réceptionnés :", blade.physics.stresses);

    // Basculement de l'état de l'application et mise à jour visuelle
    appState.mode = "simulation";
    redraw();

  } catch (error) {
    console.error("Échec de la communication avec le solveur :", error);
    alert("Erreur de connexion au solveur Python. Vérifiez que Uvicorn est en cours d'exécution.");
  }
}

// --- Moteur Colorimétrique (Heatmap) ---
function getStressColor(stress, maxStress, entityType) {
  // Tolérance pour ignorer les contraintes quasi-nulles
  if (maxStress <= 0 || stress <= 0) {
    return entityType === "blade" ? "rgba(180, 180, 180, 0.7)" : "rgba(173, 216, 230, 0.7)";
  }
  
  const ratio = Math.min(1, Math.max(0, stress / maxStress));

  // Seuil mort : les contraintes inférieures à 10% du maximum ne sont pas colorées
  if (ratio < 0.1) {
    return entityType === "blade" ? "rgba(180, 180, 180, 0.7)" : "rgba(173, 216, 230, 0.7)";
  }

  if (entityType === "blade") {
    // Tons chauds : Jaune (60°) vers Rouge (0°)
    const hue = (1 - ratio) * 60; 
    return `hsla(${hue}, 100%, 50%, 0.85)`;
  } else {
    // Tons froids : Bleu (240°) vers Magenta (300°)
    const hue = 240 + (ratio * 60); 
    return `hsla(${hue}, 100%, 50%, 0.85)`;
  }
}

// --- Protocole WebSocket et Timeline ---
function connectSimulationStream() {
  const statusIndicator = document.getElementById("ws-status");
  
  // Remplacer l'URL plus tard par la vraie adresse de votre serveur Python
  wsConnection = new WebSocket("ws://localhost:8000/stream");

  wsConnection.onopen = () => {
    statusIndicator.textContent = "● Connecté (Calcul en cours...)";
    statusIndicator.style.color = "#28a745"; 
    appState.mode = "simulation"; 
    
    // NOUVEAU : Envoi du payload géométrique dès l'ouverture du canal
    const payload = {
      blade: blade,
      obstacle: obstacle
    };
    wsConnection.send(JSON.stringify(payload));
  };

  wsConnection.onmessage = (event) => {
    // 1. Sauvegarde des données
    const frameData = JSON.parse(event.data);
    simulationBuffer.push(frameData);
    
    // 2. Mise à jour de l'interface
    statusIndicator.textContent = "● Flux actif";
    statusIndicator.style.color = "#007bff"; // Bleu
    document.getElementById("buffer-size").textContent = `${simulationBuffer.length} frames`;
    
    // 3. Déverrouillage et extension de la timeline
    const slider = document.getElementById("sim-slider");
    slider.disabled = false;
    slider.max = simulationBuffer.length - 1;
    
    // 4. Auto-scroll : si l'utilisateur regarde la dernière frame, 
    // le curseur avance tout seul avec les nouvelles données
    if (parseInt(slider.value) >= simulationBuffer.length - 2) {
      slider.value = simulationBuffer.length - 1;
      currentFrameIndex = simulationBuffer.length - 1;
      updateTimelineUI();
    }
  };

  wsConnection.onerror = () => {
    statusIndicator.textContent = "● Erreur réseau";
    statusIndicator.style.color = "#dc3545"; // Rouge
  };
}

function updateTimelineUI() {
  if (simulationBuffer.length === 0) return;
  
  // Extraction des données de la frame ciblée
  const frame = simulationBuffer[currentFrameIndex];
  
  // Affichage de la distance de pénétration en cm
  document.getElementById("sim-displacement").textContent = `${frame.blade_displacement_cm.toFixed(2)} cm`;
  
  // Recalcul visuel
  redraw();
}

// --- Écouteurs pour la timeline ---
document.getElementById("btn-start-stream")?.addEventListener("click", connectSimulationStream);
document.getElementById("sim-slider")?.addEventListener("input", (e) => {
  currentFrameIndex = parseInt(e.target.value);
  updateTimelineUI();
});