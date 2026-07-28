const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");

// --- Base de données des Matériaux ---
const materialsDB = {
  "steel": { name: "Acier", color: "rgba(180, 180, 180, 0.7)" },
  "wood":  { name: "Bois de Frêne", color: "rgba(139, 69, 19, 0.7)" }
};

// --- Modèle de données factorisé ---
let blade = {
  type: "blade",
  contour: [],
  regions: [],       // Stocke les sous-zones (tableaux d'index)
  internalEdges: [], // Stocke les segments internes pour l'affichage
  fixations: [], // Stocke les coordonnées des rectangles {x, y, w, h}
  isClosed: false,
  mesh: { vertices: [], elements: [] },
  physics: { centroid: { x: 0, y: 0 }, area: 0, mass: 1.0, stresses: [] },
  kinematics: { velocity: null }
};

let obstacle = {
  type: "obstacle",
  contour: [],
  regions: [],
  internalEdges: [],
  isClosed: false,
  mesh: { vertices: [], elements: [] },
  physics: { centroid: { x: 0, y: 0 }, area: 0, mass: 0 }
};

// --- Machine à États ---
const appState = {
  mode: "draw_blade", // draw_blade, draw_obstacle, move, erase, paint, simulation
  currentMaterial: "steel",
  showMeshLines: true,
  draggedPoint: null, // Référence au point en cours de déplacement
  activeTarget: null,  // Entité affectée par le déplacement
  segmentStart: null, // Mémoire du 1er point cliqué pour le segment
  fixationStart: null // Point d'origine du rectangle de fixation
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

// --- Système de Sauvegarde (Export JSON) ---
document.getElementById("btn-save")?.addEventListener("click", () => {
  // On regroupe les entités à sauvegarder
  const projectData = {
    blade: blade,
    obstacle: obstacle
  };

  // Conversion en texte JSON formaté
  const dataString = JSON.stringify(projectData, null, 2);
  
  // Création d'un fichier virtuel
  const blob = new Blob([dataString], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  
  // Déclenchement automatique du téléchargement
  const a = document.createElement("a");
  a.href = url;
  a.download = "projet_hache.json";
  a.click();
  
  // Nettoyage de la mémoire
  URL.revokeObjectURL(url);
});

// --- Système de Chargement (Import JSON) ---
// 1. Le clic sur le bouton simule un clic sur l'input type="file" invisible
document.getElementById("btn-load")?.addEventListener("click", () => {
  document.getElementById("input-load").click(); 
});

// 2. Traitement du fichier une fois sélectionné
document.getElementById("input-load")?.addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (event) => {
    try {
      const parsedData = JSON.parse(event.target.result);
      
      // Injection des données dans le modèle
      if (parsedData.blade) blade = parsedData.blade;
      if (parsedData.obstacle) obstacle = parsedData.obstacle;
      
      // Réinitialisation de l'historique pour éviter les conflits d'état
      historyManager.undoStack = [];
      historyManager.redoStack = [];
      updateHistoryUI();
      
      redraw();
      console.log("Projet chargé avec succès.");
      
    } catch (error) {
      console.error("Fichier corrompu ou format invalide :", error);
      alert("Erreur lors de la lecture du fichier de sauvegarde.");
    }
  };
  
  reader.readAsText(file);
  e.target.value = ""; // Réinitialise l'input pour permettre de recharger le même fichier
});

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

// --- Moteur de Simulation (Buffer Temporel) ---
const simulationBuffer = []; // Stockera toutes les frames JSON reçues
let currentFrameIndex = 0;   // Position actuelle de lecture sur la timeline
let wsConnection = null;     // L'instance de la connexion serveur

// --- Initialisation ---
function resizeCanvas() {
  const container = document.getElementById("canvas-container");
  if (!container) return;

  // S'adapte à la largeur du conteneur parent
  canvas.width = container.clientWidth;
  
  // Calcule la position exacte du haut du canevas sur l'écran
  const rect = canvas.getBoundingClientRect();
  
  // La hauteur devient : l'écran total MOINS l'espace occupé au-dessus
  // On retire encore 5 ou 10 pixels pour avoir une petite marge de respiration en bas
  canvas.height = window.innerHeight - rect.top - 10; 
  
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

// Détecte le point le plus proche de la souris
function findClosestPoint(mx, my, threshold = 15) {
  for (let target of [blade, obstacle]) {
    for (let i = 0; i < target.contour.length; i++) {
      let p = target.contour[i];
      if (distance(mx, my, p.x, p.y) < threshold) {
        return { target: target, point: p, index: i };
      }
    }
  }
  return null;
}

// Détecte si un point (px, py) est à l'intérieur d'un triangle
function isPointInTriangle(px, py, ax, ay, bx, by, cx, cy) {
  let v0x = cx - ax, v0y = cy - ay;
  let v1x = bx - ax, v1y = by - ay;
  let v2x = px - ax, v2y = py - ay;

  let dot00 = v0x * v0x + v0y * v0y;
  let dot01 = v0x * v1x + v0y * v1y;
  let dot02 = v0x * v2x + v0y * v2y;
  let dot11 = v1x * v1x + v1y * v1y;
  let dot12 = v1x * v2x + v1y * v2y;

  let invDenom = 1 / (dot00 * dot11 - dot01 * dot01);
  let u = (dot11 * dot02 - dot01 * dot12) * invDenom;
  let v = (dot00 * dot12 - dot01 * dot02) * invDenom;

  return (u >= 0) && (v >= 0) && (u + v < 1);
}

// Calcule la distance entre un point (px, py) et un segment [A, B]
function pointToSegmentDistance(px, py, ax, ay, bx, by) {
  const l2 = (bx - ax) ** 2 + (by - ay) ** 2;
  if (l2 === 0) return distance(px, py, ax, ay);
  let t = ((px - ax) * (bx - ax) + (py - ay) * (by - ay)) / l2;
  t = Math.max(0, Math.min(1, t)); // Restreint la projection strictement sur le segment
  const projX = ax + t * (bx - ax);
  const projY = ay + t * (by - ay);
  return distance(px, py, projX, projY);
}

// Applique le matériau sélectionné au triangle survolé
function paintTriangleAt(mx, my) {
  if (!blade.isClosed) return;
  const vertices = blade.mesh.vertices;
  
  for (let element of blade.mesh.elements) {
    let p0 = vertices[element.nodes[0]];
    let p1 = vertices[element.nodes[1]];
    let p2 = vertices[element.nodes[2]];
    
    if (isPointInTriangle(mx, my, p0.x, p0.y, p1.x, p1.y, p2.x, p2.y)) {
      element.material = appState.currentMaterial;
      redraw();
      break; // Un seul triangle à la fois
    }
  }
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

function generateMesh(target) {
  if (target.contour.length < 3) {
    target.mesh.vertices = [];
    target.mesh.elements = [];
    return;
  }

  if (!target.regions || target.regions.length === 0) {
    target.regions = [Array.from({length: target.contour.length}, (_, i) => i)];
  }

  target.mesh.vertices = [...target.contour];
  target.mesh.elements = [];
  
  target.regions.forEach(regionIndices => {
    const flatCoords = [];
    regionIndices.forEach(idx => {
      if (target.contour[idx]) {
        flatCoords.push(target.contour[idx].x, target.contour[idx].y);
      }
    });

    if (flatCoords.length < 6) return; // Sécurité : minimum 3 points

    const earcutIndices = earcut(flatCoords);
    
    for (let i = 0; i < earcutIndices.length; i += 3) {
      target.mesh.elements.push({
        nodes: [
          regionIndices[earcutIndices[i]],
          regionIndices[earcutIndices[i+1]],
          regionIndices[earcutIndices[i+2]]
        ],
        material: "steel"
      });
    }
  });

  const centroidData = calculateCentroid(target.contour);
  target.physics.centroid = { x: centroidData.x, y: centroidData.y };
  target.physics.area = centroidData.area;

  if (target.type === "blade" && !target.kinematics.velocity) {
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

// --- Événements Interface (Boutons) ---
document.getElementById("btn-toggle-mesh")?.addEventListener("click", () => {
  appState.showMeshLines = !appState.showMeshLines;
  redraw();
});

// --- Événements Interface (Menu déroulant) ---
document.getElementById("select-tool")?.addEventListener("change", (e) => {
  appState.mode = e.target.value;
});
document.getElementById("select-material")?.addEventListener("change", (e) => {
  appState.currentMaterial = e.target.value;
});

// --- Événements Souris (Interaction Canvas) ---
canvas.addEventListener("mousedown", e => {
  const rect = canvas.getBoundingClientRect();
  const mx = e.clientX - rect.left;
  const my = e.clientY - rect.top;

  if (appState.mode === "simulation") return;

  // 1. PRIORITÉ ABSOLUE : Interaction avec la flèche cinématique (Vecteur vitesse)
  if (blade.isClosed && blade.kinematics.velocity) {
    const v = blade.kinematics.velocity;
    if (distance(mx, my, v.endX, v.endY) < 15) {
      appState.draggingVelocity = true;
      return; // On stoppe l'exécution ici, on ne dessine rien
    }
  }

  saveState();

  // 2. Outils de Tracé
  if (appState.mode === "draw_blade" || appState.mode === "draw_obstacle") {
    const target = appState.mode === "draw_blade" ? blade : obstacle;
    if (!target.isClosed) {
      if (target.contour.length > 2 && distance(mx, my, target.contour[0].x, target.contour[0].y) < 15) {
        target.isClosed = true;
        generateMesh(target);
      } else {
        target.contour.push({ x: mx, y: my });
        redraw();
      }
    }
  } 
  // 3. Outil : Insérer un point
  else if (appState.mode === "insert") {
    for (let target of [blade, obstacle]) {
      if (!target.isClosed) continue;
      
      let minDist = 15; // Seuil de détection (pixels)
      let bestIndex = -1;
      
      // Recherche de l'arête la plus proche
      for (let i = 0; i < target.contour.length; i++) {
        let p1 = target.contour[i];
        let p2 = target.contour[(i + 1) % target.contour.length];
        let d = pointToSegmentDistance(mx, my, p1.x, p1.y, p2.x, p2.y);
        
        if (d < minDist) {
          minDist = d;
          bestIndex = i;
        }
      }
      
      if (bestIndex !== -1) {
        target.contour.splice(bestIndex + 1, 0, { x: mx, y: my });
        // Sécurité : on supprime les découpes internes si on change le périmètre
        target.regions = []; 
        target.internalEdges = [];
        generateMesh(target);
        break; //un seul a la fois
      }
    }
  }
  // 4. Outil : Déplacer
  else if (appState.mode === "move") {
    const closest = findClosestPoint(mx, my);
    if (closest) {
      appState.draggedPoint = closest.point;
      appState.activeTarget = closest.target;
    }
  } 
  // 5. Outil : Gommer
  // 5. Outil : Gommer (Segments ou Points)
  else if (appState.mode === "erase") {
    // A. Priorité 1 : Clic sur un segment interne -> supprime uniquement ce segment
    const closestEdge = findClosestInternalEdge(mx, my, 12);
    if (closestEdge) {
      closestEdge.target.internalEdges.splice(closestEdge.index, 1);
      rebuildRegionsFromEdges(closestEdge.target);
      generateMesh(closestEdge.target);
      redraw();
      return;
    }

    // B. Priorité 2 : Clic sur un point du contour -> supprime le point et réajuste les index
    const closest = findClosestPoint(mx, my, 15);
    if (closest) {
      const target = closest.target;
      const removeIdx = closest.index;

      target.contour.splice(removeIdx, 1);

      if (target.contour.length < 3) {
        // La géométrie devient incomplète : réinitialisation propre de l'état
        target.isClosed = false;
        target.regions = [];
        target.internalEdges = [];
        target.mesh.vertices = [];
        target.mesh.elements = [];
      } else if (target.isClosed) {
        // Réalignement des index des segments restants (> removeIdx)
        if (target.internalEdges) {
          target.internalEdges = target.internalEdges
            .filter(e => e.p1 !== removeIdx && e.p2 !== removeIdx)
            .map(e => ({
              p1: e.p1 > removeIdx ? e.p1 - 1 : e.p1,
              p2: e.p2 > removeIdx ? e.p2 - 1 : e.p2
            }));
        }
        rebuildRegionsFromEdges(target);
        generateMesh(target);
      }
      redraw();
    }
  }
  // Outil : Ajouter un segment de séparation
  else if (appState.mode === "add_segment") {
    const closest = findClosestPoint(mx, my, 15);
    if (closest && closest.target.isClosed) {
      if (!appState.segmentStart) {
        // Premier clic : on mémorise le point
        appState.segmentStart = closest;
        redraw();
      } else {
        // Second clic : on relie si c'est sur la même entité
        if (appState.segmentStart.target === closest.target) {
          splitRegion(closest.target, appState.segmentStart.index, closest.index);
        }
        appState.segmentStart = null; // On réinitialise
        redraw();
      }
    } else {
      appState.segmentStart = null; // Annulation si clic dans le vide
      redraw();
    }
  }
  // Outil : Ajouter une main de fixation
  else if (appState.mode === "fixation") {
    if (blade.isClosed) {
      appState.fixationStart = { x: mx, y: my };
    }
  }
  // Outil : Peindre
  else if (appState.mode === "paint") {
    paintTriangleAt(mx, my);
  }
});

canvas.addEventListener("mousemove", e => {
  const rect = canvas.getBoundingClientRect();
  const mx = e.clientX - rect.left;
  const my = e.clientY - rect.top;

  // Déplacement exclusif de la flèche de vitesse
  if (appState.draggingVelocity && blade.kinematics.velocity) {
    blade.kinematics.velocity.endX = mx;
    blade.kinematics.velocity.endY = my;
    syncVelocityInputs();
    redraw();
    return;
  }

  // Outil Déplacer un point géométrique
  if (appState.mode === "move" && appState.draggedPoint) {
    appState.draggedPoint.x = mx;
    appState.draggedPoint.y = my;
    if (appState.activeTarget.isClosed) generateMesh(appState.activeTarget);
    redraw();
  }
  // Outil Peindre en continu (Clic maintenu)
  else if (appState.mode === "paint" && e.buttons === 1) {
    paintTriangleAt(mx, my);
  }

  // Outil : Dessiner le rectangle de fixation en temps réel
  else if (appState.mode === "fixation" && appState.fixationStart) {
    redraw(); // Efface l'image précédente
    
    const rectX = appState.fixationStart.x;
    const rectY = appState.fixationStart.y;
    const rectW = mx - rectX;
    const rectH = my - rectY;

    ctx.fillStyle = "rgba(0, 255, 0, 0.3)";
    ctx.strokeStyle = "rgba(0, 200, 0, 0.8)";
    ctx.lineWidth = 1;
    ctx.fillRect(rectX, rectY, rectW, rectH);
    ctx.strokeRect(rectX, rectY, rectW, rectH);
  }
});

window.addEventListener("mouseup", (e) => {
  // 1. Recalcul indispensable de la position de la souris pour cet événement
  const rect = canvas.getBoundingClientRect();
  const mx = e.clientX - rect.left;
  const my = e.clientY - rect.top;

  // 2. Validation du rectangle de fixation
  if (appState.mode === "fixation" && appState.fixationStart) {
    blade.fixations.push({
      x: appState.fixationStart.x,
      y: appState.fixationStart.y,
      w: mx - appState.fixationStart.x,
      h: my - appState.fixationStart.y
    });
    appState.fixationStart = null; // On libère l'outil
    redraw(); // Affichage définitif du rectangle
  }
  
  // 3. Libération des autres outils
  appState.draggingVelocity = false;
  appState.draggedPoint = null;
  appState.activeTarget = null;
});

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

    // Dessin des segments internes
    if (target.internalEdges && target.internalEdges.length > 0) {
      ctx.strokeStyle = target.type === "blade" ? "#666" : "#004085";
      ctx.lineWidth = 2;
      ctx.beginPath();
      target.internalEdges.forEach(edge => {
        ctx.moveTo(contourToDraw[edge.p1].x, contourToDraw[edge.p1].y);
        ctx.lineTo(contourToDraw[edge.p2].x, contourToDraw[edge.p2].y);
      });
      ctx.stroke();
    }
    
    // Nœuds de contrôle (Visibles uniquement pendant le tracé, pas en simulation)
    if ((!target.isClosed || appState.showMeshLines) && appState.mode !== "simulation") {
      ctx.fillStyle = target.type === "blade" ? "blue" : "darkcyan";
      contourToDraw.forEach(p => {
        ctx.beginPath();
        ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
        ctx.fill();
      });
    }
  }

  // 3. Dessin du maillage
  if (target.isClosed && target.mesh.elements.length > 0) {
    let maxStress = activeStresses ? Math.max(...activeStresses) : 0;

    target.mesh.elements.forEach((element, triIndex) => {
      // Récupération de la couleur du matériau défini
      let baseColor = materialsDB[element.material] ? materialsDB[element.material].color : "rgba(180, 180, 180, 0.7)";
      
      let fillColor = baseColor;
      if (activeStresses && activeStresses[triIndex] !== undefined) {
        fillColor = getStressColor(activeStresses[triIndex], maxStress, baseColor);
      }
      
      ctx.fillStyle = fillColor;
      ctx.beginPath();
      ctx.moveTo(meshVertices[element.nodes[0]].x, meshVertices[element.nodes[0]].y);
      ctx.lineTo(meshVertices[element.nodes[1]].x, meshVertices[element.nodes[1]].y);
      ctx.lineTo(meshVertices[element.nodes[2]].x, meshVertices[element.nodes[2]].y);
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
  // 4. Dessin des Fixations (Uniquement pour la lame)
  if (target.type === "blade" && target.fixations && target.fixations.length > 0) {
    target.fixations.forEach(rect => {
      ctx.fillStyle = "rgba(0, 255, 0, 0.2)";
      ctx.strokeStyle = "rgba(0, 200, 0, 0.5)";
      ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
      ctx.strokeRect(rect.x, rect.y, rect.w, rect.h);
    });

    // Identification visuelle des nœuds verrouillés
    ctx.fillStyle = "lime";
    meshVertices.forEach(v => {
      let isFixed = false;
      for (let rect of target.fixations) {
        if (isPointInRect(v.x, v.y, rect)) {
          isFixed = true;
          break;
        }
      }
      if (isFixed) {
        ctx.beginPath();
        ctx.arc(v.x, v.y, 4, 0, Math.PI * 2);
        ctx.fill();
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
  // Indication visuelle de l'outil Segment
  if (appState.mode === "add_segment" && appState.segmentStart) {
    ctx.fillStyle = "orange";
    ctx.beginPath();
    ctx.arc(appState.segmentStart.point.x, appState.segmentStart.point.y, 6, 0, Math.PI * 2);
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
      <p style="font-size: 13px; margin: 2px 0 10px 0;"><strong>Triangles:</strong> ${entity.mesh.elements.length}</p>
      
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
  // 1. Vérifications de sécurité
  if (!blade.isClosed || blade.mesh.elements.length === 0) {
    alert("Erreur : La géométrie de la lame doit être fermée et maillée.");
    return;
  }
  if (!wsConnection || wsConnection.readyState !== WebSocket.OPEN) {
    alert("Erreur : Le serveur n'est pas connecté.");
    return;
  }

  // --- NOUVEAU : Purge du buffer et réinitialisation de la timeline ---
  simulationBuffer.length = 0; 
  currentFrameIndex = 0;
  
  const slider = document.getElementById("sim-slider");
  if (slider) {
    slider.value = 0;
    slider.max = 0;
  }

  // Détermination des index des nœuds fixés
  const fixedNodesIndices = [];
  blade.mesh.vertices.forEach((v, index) => {
    for (let rect of blade.fixations) {
      if (isPointInRect(v.x, v.y, rect)) {
        fixedNodesIndices.push(index);
        break;
      }
    }
  }); 
  // -------------------------------------------------------------------

  // 3. Construction du payload
  const payload = {
    blade: {
      mesh: {
        vertices: blade.mesh.vertices.map(v => ({ x: v.x, y: v.y })),
        elements: blade.mesh.elements 
      },
      boundary_conditions: {
        fixed_nodes: fixedNodesIndices // Transmission des encastrements
      },
      kinematics: {
        velocity: {
          startX: blade.kinematics.velocity.startX,
          startY: blade.kinematics.velocity.startY,
          endX: blade.kinematics.velocity.endX,
          endY: blade.kinematics.velocity.endY
        }
      }
    },
    obstacle: {
      mesh: {
        vertices: obstacle.mesh.vertices.map(v => ({ x: v.x, y: v.y })),
        elements: obstacle.mesh.elements 
      }
    }
  };

  // 4. Envoi via le tunnel WebSocket
  wsConnection.send(JSON.stringify(payload));
  
  // 5. Basculement de l'interface
  appState.mode = "simulation";
  redraw();
}

// --- Moteur Colorimétrique ---
function getStressColor(stress, maxStress, baseColor) {
  if (!maxStress || stress <= 0 || (stress / maxStress) < 0.1) return baseColor;
  const ratio = Math.min(1, Math.max(0, stress / maxStress));
  // Superpose une teinte rouge d'intensité variable
  return `hsla(${(1 - ratio) * 60}, 100%, 50%, 0.85)`;
}


function connectSimulationStream() {
  const statusIndicator = document.getElementById("ws-status");
  
  if (wsConnection && wsConnection.readyState === WebSocket.OPEN) {
    return; // Déjà connecté
  }

  statusIndicator.textContent = "● Connexion en cours...";
  statusIndicator.style.color = "#ffc107"; // Jaune

  wsConnection = new WebSocket("ws://localhost:8000/stream");

  wsConnection.onopen = () => {
    statusIndicator.textContent = "● Connecté (Prêt pour l'envoi)";
    statusIndicator.style.color = "#28a745"; // Vert
    
    // NOUVEAU : Activation du bouton d'envoi uniquement ici !
    const btnSim = document.getElementById("btn-sim");
    if (btnSim) {
      btnSim.disabled = false;
      btnSim.style.opacity = "1";
    }
  };

  wsConnection.onclose = (event) => {
    statusIndicator.textContent = "● Déconnecté (Serveur fermé)";
    statusIndicator.style.color = "#6c757d"; // Gris
    
    // On reverrouille le bouton d'envoi car la ligne est coupée
    const btnSim = document.getElementById("btn-sim");
    if (btnSim) btnSim.disabled = true;
    
    console.warn("WebSocket fermé par le serveur. Code:", event.code);
  };

  wsConnection.onmessage = (event) => {
    const frameData = JSON.parse(event.data);
    simulationBuffer.push(frameData);
    
    statusIndicator.textContent = "● Calcul en cours...";
    statusIndicator.style.color = "#007bff"; // Bleu
    document.getElementById("buffer-size").textContent = `${simulationBuffer.length} frames`;
    
    const slider = document.getElementById("sim-slider");
    slider.disabled = false;
    slider.max = simulationBuffer.length - 1;
    
    if (parseInt(slider.value) >= simulationBuffer.length - 2) {
      slider.value = simulationBuffer.length - 1;
      currentFrameIndex = simulationBuffer.length - 1;
      updateTimelineUI();
    }
  };

  wsConnection.onerror = () => {
    statusIndicator.textContent = "● Erreur réseau";
    statusIndicator.style.color = "#dc3545"; // Rouge
    // On re-verrouille le bouton si la connexion plante
    if (document.getElementById("btn-sim")) document.getElementById("btn-sim").disabled = true;
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
document.getElementById("btn-sim")?.addEventListener("click", runSimulation);
document.getElementById("sim-slider")?.addEventListener("input", (e) => {
  currentFrameIndex = parseInt(e.target.value);
  updateTimelineUI();
});

document.getElementById("btn-edit")?.addEventListener("click", () => {
  // 1. On lit quel outil est actuellement sélectionné dans le menu déroulant
  const toolSelector = document.getElementById("select-tool");
  const fallbackTool = toolSelector ? toolSelector.value : "draw_blade";

  // 2. On change le mode global de l'application
  appState.mode = fallbackTool;

  // 3. On redessine le canevas
  redraw();
});

// Détecte si la souris survole un segment interne
function findClosestInternalEdge(mx, my, threshold = 12) {
  for (let target of [blade, obstacle]) {
    if (!target.isClosed || !target.internalEdges) continue;
    for (let i = 0; i < target.internalEdges.length; i++) {
      let edge = target.internalEdges[i];
      let p1 = target.contour[edge.p1];
      let p2 = target.contour[edge.p2];
      if (p1 && p2) {
        let d = pointToSegmentDistance(mx, my, p1.x, p1.y, p2.x, p2.y);
        if (d < threshold) {
          return { target: target, index: i };
        }
      }
    }
  }
  return null;
}

// Subdivise une région géométrique
function splitRegionWithoutAddingEdge(target, index1, index2) {
  for (let r = 0; r < target.regions.length; r++) {
    const region = target.regions[r];
    const pos1 = region.indexOf(index1);
    const pos2 = region.indexOf(index2);

    if (pos1 !== -1 && pos2 !== -1) {
      const minPos = Math.min(pos1, pos2);
      const maxPos = Math.max(pos1, pos2);

      if (maxPos - minPos <= 1 || (minPos === 0 && maxPos === region.length - 1)) {
        return false;
      }

      const regionA = [];
      for(let i = 0; i <= minPos; i++) regionA.push(region[i]);
      for(let i = maxPos; i < region.length; i++) regionA.push(region[i]);

      const regionB = [];
      for(let i = minPos; i <= maxPos; i++) regionB.push(region[i]);

      target.regions.splice(r, 1, regionA, regionB);
      return true;
    }
  }
  return false;
}

// Ajoute un segment et re-maille
function splitRegion(target, index1, index2) {
  if (splitRegionWithoutAddingEdge(target, index1, index2)) {
    target.internalEdges.push({ p1: index1, p2: index2 });
    generateMesh(target);
  }
}

// Reconstruit proprement les sous-zones après suppression d'un point ou d'un segment
function rebuildRegionsFromEdges(target) {
  if (target.contour.length < 3) {
    target.regions = [];
    return;
  }
  target.regions = [Array.from({length: target.contour.length}, (_, i) => i)];

  const validEdges = [];
  if (target.internalEdges) {
    for (let edge of target.internalEdges) {
      if (splitRegionWithoutAddingEdge(target, edge.p1, edge.p2)) {
        validEdges.push(edge);
      }
    }
  }
  target.internalEdges = validEdges;
}

// Évalue si un point (px, py) est contenu dans un rectangle
function isPointInRect(px, py, rect) {
  // Prise en compte des tracés inversés (largeur/hauteur négatives)
  const minX = Math.min(rect.x, rect.x + rect.w);
  const maxX = Math.max(rect.x, rect.x + rect.w);
  const minY = Math.min(rect.y, rect.y + rect.h);
  const maxY = Math.max(rect.y, rect.y + rect.h);

  return px >= minX && px <= maxX && py >= minY && py <= maxY;
}