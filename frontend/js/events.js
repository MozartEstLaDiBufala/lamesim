import { appState, blade, obstacle, historyManager, overwriteState, simulationState, simulationParams } from './state.js';
import { canvas, ctx, redraw } from './render.js';
import { runSimulation, connectSimulationStream, updateTimelineUI } from './network.js';
import { distance, isPointInTriangle, pointToSegmentDistance } from './mathUtils.js';
import { findClosestPoint, findClosestInternalEdge, rebuildRegionsFromEdges, generateMesh, splitRegion } from './geometry.js';

function updateHistoryUI() {
  const btnUndo = document.getElementById("btn-undo"), btnRedo = document.getElementById("btn-redo");
  if (btnUndo) btnUndo.disabled = historyManager.undoStack.length === 0;
  if (btnRedo) btnRedo.disabled = historyManager.redoStack.length === 0;
}

function saveState() {
  historyManager.undoStack.push(structuredClone({ blade, obstacle }));
  if (historyManager.undoStack.length > historyManager.maxSize) historyManager.undoStack.shift();
  historyManager.redoStack = [];
  updateHistoryUI();
}

function undo() {
  if (historyManager.undoStack.length === 0) return;
  historyManager.redoStack.push(structuredClone({ blade, obstacle }));
  const pastState = historyManager.undoStack.pop();
  overwriteState(pastState.blade, pastState.obstacle);
  updateHistoryUI(); redraw();
}

function redo() {
  if (historyManager.redoStack.length === 0) return;
  historyManager.undoStack.push(structuredClone({ blade, obstacle }));
  const futureState = historyManager.redoStack.pop();
  overwriteState(futureState.blade, futureState.obstacle);
  updateHistoryUI(); redraw();
}

// --- Fonctions utilitaires locales aux événements ---
function syncVelocityInputs() {
  const v = blade.kinematics.velocity;
  if (!v) return;
  const vxInput = document.getElementById("input-vx");
  const vyInput = document.getElementById("input-vy");
  if (vxInput) vxInput.value = Math.round(v.endX - v.startX);
  if (vyInput) vyInput.value = Math.round(v.endY - v.startY);
}

function paintTriangleAt(mx, my) {
  // Itération séquentielle sur les entités disponibles
  for (let target of [blade, obstacle]) {
    if (!target.isClosed) continue;
    
    const vertices = target.mesh.vertices;
    
    for (let element of target.mesh.elements) {
      let p0 = vertices[element.nodes[0]];
      let p1 = vertices[element.nodes[1]];
      let p2 = vertices[element.nodes[2]];
      
      // Vérification mathématique de la collision
      if (isPointInTriangle(mx, my, p0.x, p0.y, p1.x, p1.y, p2.x, p2.y)) {
        element.material = appState.currentMaterial;
        redraw();
        return; // Interruption immédiate pour ne peindre qu'un seul triangle, même en cas de superposition
      }
    }
  }
}

export function initEvents() {
  // Clavier
  document.addEventListener("keydown", (e) => {
    if (e.ctrlKey && e.key === 'z') { e.preventDefault(); undo(); } 
    else if ((e.ctrlKey && e.key === 'y') || (e.ctrlKey && e.shiftKey && e.key === 'Z')) { e.preventDefault(); redo(); }
  });

  // Boutons UI
  document.getElementById("btn-undo")?.addEventListener("click", undo);
  document.getElementById("btn-redo")?.addEventListener("click", redo);
  document.getElementById("btn-toggle-meshpoint")?.addEventListener("click", () => { appState.showPointMeshLines = !appState.showPointMeshLines; redraw(); });
  document.getElementById("btn-toggle-measurements")?.addEventListener("click", () => {appState.showMeasurements = !appState.showMeasurements;redraw(); });
  document.getElementById("select-tool")?.addEventListener("change", (e) => { appState.mode = e.target.value; });
  document.getElementById("select-material")?.addEventListener("change", (e) => {
    // 1. Mise à jour du matériau actif
    appState.currentMaterial = e.target.value;
    
    // 2. Forçage de l'outil de peinture
    appState.mode = "paint";
    
    // 3. Synchronisation de l'interface graphique (sélecteur d'outil)
    const toolSelector = document.getElementById("select-tool");
    if (toolSelector) {
      toolSelector.value = "paint";
    }
  });
  document.getElementById("btn-start-stream")?.addEventListener("click", connectSimulationStream);

  const btnSim = document.getElementById("btn-sim");
  btnSim.addEventListener("click", () => {
    runSimulation();
  });

  document.getElementById("sim-slider")?.addEventListener("input", (e) => {
    simulationState.currentIndex = parseInt(e.target.value);
    updateTimelineUI();
  });

  // Synchronisation des paramètres temporels
  document.getElementById("input-time-step")?.addEventListener("input", (e) => {
    const val = parseFloat(e.target.value);
    if (!isNaN(val) && val > 0) simulationParams.timeStep = val;
  });

  document.getElementById("input-num-steps")?.addEventListener("input", (e) => {
    const val = parseInt(e.target.value, 10);
    if (!isNaN(val) && val > 0) simulationParams.numSteps = val;
  });

  // Synchronisation des inputs HTML vers le modèle (flèche)
  const syncVelocityFromInputs = () => {
    const v = blade.kinematics.velocity;
    if (!v) return;
    const vx = parseFloat(document.getElementById("input-vx").value) || 0;
    const vy = parseFloat(document.getElementById("input-vy").value) || 0;
    v.endX = v.startX + vx;
    v.endY = v.startY + vy;
    redraw(); // Fonction importée depuis render.js
  };

  document.getElementById("input-vx")?.addEventListener("input", syncVelocityFromInputs);
  document.getElementById("input-vy")?.addEventListener("input", syncVelocityFromInputs);

  // --- Édition manuelle des coordonnées depuis les tableaux de données ---
  document.getElementById("data-content")?.addEventListener("input", (e) => {
    // On vérifie que l'élément modifié est bien un de nos champs d'édition
    if (e.target.classList.contains("coord-input")) {
      const entityType = e.target.getAttribute("data-entity");
      const idx = parseInt(e.target.getAttribute("data-index"));
      const coord = e.target.getAttribute("data-coord");
      const val = parseFloat(e.target.value);

      // Sécurité : ignorer les saisies incomplètes (ex: le signe "-" seul)
      if (isNaN(val)) return;

      const target = entityType === "blade" ? blade : obstacle;
      
      if (target.contour[idx]) {
        // Mise à jour de la coordonnée dans le modèle
        target.contour[idx][coord] = val;

        // Si l'utilisateur modifie X ou Y, la géométrie change, il faut remailler
        if ((coord === 'x' || coord === 'y' || coord === 't') && target.isClosed) {
          generateMesh(target);
        }
        
        // Rafraîchissement du canvas graphique
        redraw();
      }
    }
  });

  // Synchronisation de la vitesse d'impact
  const speedInput = document.getElementById("input-impact-speed");
  if (speedInput) {
    // 1. Synchronisation initiale forcée (Capture de la valeur HTML au chargement)
    if (blade.kinematics) {
      blade.kinematics.impactSpeed = parseFloat(speedInput.value) || 0;
    }
    // 2. Maintien de la synchronisation lors des modifications futures
    speedInput.addEventListener("input", (e) => {
      if (blade.kinematics) {
        blade.kinematics.impactSpeed = parseFloat(e.target.value) || 0;
      }
    });
  }

  // --- Système de Sauvegarde (Export JSON) ---
  document.getElementById("btn-save")?.addEventListener("click", () => {
    const projectData = { blade, obstacle };
    const blob = new Blob([JSON.stringify(projectData, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "projet_hache.json";
    a.click();
    URL.revokeObjectURL(url);
  });

  document.getElementById("input-thickness")?.addEventListener("input", (e) => {
    appState.currentThickness = parseFloat(e.target.value);
    document.getElementById("thickness-display").textContent = `${appState.currentThickness.toFixed(1)} cm`;
  });
    
  // --- Système de Chargement (Import JSON) ---
  document.getElementById("btn-load")?.addEventListener("click", () => {
    document.getElementById("input-load").click(); 
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
  
  document.getElementById("input-load")?.addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const parsedData = JSON.parse(event.target.result);
        overwriteState(parsedData.blade || blade, parsedData.obstacle || obstacle);
        historyManager.undoStack = [];
        historyManager.redoStack = [];
        redraw();
      } catch (error) {
        alert("Erreur lors de la lecture du fichier de sauvegarde.");
      }
    };
    reader.readAsText(file);
    e.target.value = ""; 
  });

  canvas.addEventListener("mousedown", e => {
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    if (appState.mode === "simulation") return;

    if (blade.isClosed && blade.kinematics.velocity) {
      const v = blade.kinematics.velocity;
      if (distance(mx, my, v.endX, v.endY) < 15) {
        appState.draggingVelocity = true;
        blade.kinematics.velocity = {
          startX: mx,
          startY: my,
          endX: v.endX,
          endY: v.endY
        };
        return; 
      }
    }

    saveState();

    if (appState.mode === "draw_blade" || appState.mode === "draw_obstacle") {
      const target = appState.mode === "draw_blade" ? blade : obstacle;
      if (!target.isClosed) {
        if (target.contour.length > 2 && distance(mx, my, target.contour[0].x, target.contour[0].y) < 15) {
          target.isClosed = true;
          generateMesh(target);
        } else {
          target.contour.push({ x: mx, y: my, t: appState.currentThickness});
          redraw();
        }
      }
    } 
    else if (appState.mode === "move") {
      const closest = findClosestPoint(mx, my);
      if (closest) {
        appState.draggedPoint = closest.point;
        appState.activeTarget = closest.target;
      }
    } 
    else if (appState.mode === "erase") {
      const closestEdge = findClosestInternalEdge(mx, my, 12);
      if (closestEdge) {
        closestEdge.target.internalEdges.splice(closestEdge.index, 1);
        rebuildRegionsFromEdges(closestEdge.target);
        generateMesh(closestEdge.target);
        redraw();
        return;
      }

      const closest = findClosestPoint(mx, my, 15);
      if (closest) {
        const target = closest.target;
        const removeIdx = closest.index;
        target.contour.splice(removeIdx, 1);

        if (target.contour.length < 3) {
          target.isClosed = false;
          target.regions = [];
          target.internalEdges = [];
          target.mesh.vertices = [];
          target.mesh.elements = [];
        } else if (target.isClosed) {
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
    else if (appState.mode === "add_segment") {
      const closest = findClosestPoint(mx, my, 15);
      if (closest && closest.target.isClosed) {
        if (!appState.segmentStart) {
          appState.segmentStart = closest;
          redraw();
        } else {
          if (appState.segmentStart.target === closest.target) {
            splitRegion(closest.target, appState.segmentStart.index, closest.index);
          }
          appState.segmentStart = null; 
          redraw();
        }
      } else {
        appState.segmentStart = null; 
        redraw();
      }
    }
    else if (appState.mode === "fixation") {
      if (blade.isClosed || obstacle.isClosed) {
        appState.fixationStart = { x: mx, y: my };
      }
    }
    else if (appState.mode === "paint") {
      paintTriangleAt(mx, my);
    }
    else if (appState.mode === "insert") {
      for (let target of [blade, obstacle]) {
        if (!target.isClosed) continue;
        let minDist = 15;
        let bestIndex = -1;
        
        for (let i = 0; i < target.contour.length; i++) {
          let p1 = target.contour[i];
          let p2 = target.contour[(i + 1) % target.contour.length];
          let d = pointToSegmentDistance(mx, my, p1.x, p1.y, p2.x, p2.y);
          if (d < minDist) { minDist = d; bestIndex = i; }
        }
        
        if (bestIndex !== -1) {
          target.contour.splice(bestIndex + 1, 0, { x: mx, y: my });
          target.regions = []; 
          target.internalEdges = [];
          generateMesh(target);
          redraw();
          break; 
        }
      }
    }
    else if (appState.mode === "thickness") {
      const closest = findClosestPoint(mx, my, 15);
      if (closest) {
        closest.point.t = appState.currentThickness;
        if (closest.target.isClosed) {
          generateMesh(closest.target);
        }
        redraw();
      }
    }
  });

  canvas.addEventListener("mousemove", e => {
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    if (appState.draggingVelocity && blade.kinematics.velocity) {
      blade.kinematics.velocity.endX = mx;
      blade.kinematics.velocity.endY = my;
      syncVelocityInputs();
      redraw();
      return;
    }

    if (appState.mode === "move" && appState.draggedPoint) {
      appState.draggedPoint.x = mx;
      appState.draggedPoint.y = my;
      if (appState.activeTarget.isClosed) generateMesh(appState.activeTarget);
      redraw();
    }
    else if (appState.mode === "paint" && e.buttons === 1) {
      paintTriangleAt(mx, my);
    }
    else if (appState.mode === "fixation" && appState.fixationStart) {
      redraw(); 
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
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    if (appState.mode === "fixation" && appState.fixationStart) {
      // Normalisation du rectangle (permet de tracer de bas en haut ou droite à gauche)
      const rect = {
        x: Math.min(appState.fixationStart.x, mx),
        y: Math.min(appState.fixationStart.y, my),
        w: Math.abs(mx - appState.fixationStart.x),
        h: Math.abs(my - appState.fixationStart.y)
      };

      // Initialisation sécurisée des tableaux et ajout du rectangle
      if (blade.isClosed) {
        if (!blade.fixations) blade.fixations = [];
        blade.fixations.push(rect);
      }
      if (obstacle.isClosed) {
        if (!obstacle.fixations) obstacle.fixations = [];
        obstacle.fixations.push(rect);
      }
      
      appState.fixationStart = null; 
      redraw(); 
    }
    
    appState.draggingVelocity = false;
    appState.draggedPoint = null;
    appState.activeTarget = null;
  });
}