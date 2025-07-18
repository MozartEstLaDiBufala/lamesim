const canvas = document.getElementById("canvas"); //pour lier le canvas de l'html et dessiner dedans
const ctx = canvas.getContext("2d"); // ctx est le contexte de dessin du canvas, il permet de dessiner des formes, du texte, etc.

let arrows = []; //let signifie que la variable peut être modifiée, contrairement à const qui est une constante
let lamePoints = [];
let lameLines = [];
let lameShapeNbActuel = 0; // pour compter le nombre de formes de lame
let lameShapeNbAncien = 0; // pour compter le nombre de formes de lame

let forcePoints = [];
let forceLines = [];
let forceShapeNb = 0; // pour compter le nombre de formes de force

let draggingPointIndexlame = null;
let draggingShapelame = null;
let draggingPointIndexforce = null;
let draggingShapeforce = null;
let draggingArrow = null;
let draggingArrowPoint = null;

let mode = "edition"; // mode d'édition ou de simulation
let subMode = null;
let mouseX = 0;
let mouseY = 0;

let lameTempline = null; // pour la ligne pointillé temporaire lors du traçage
let lameTraceStartIndex = null; // pour le point de départ du traçage

let forceTempline = null; // pour la ligne pointillé temporaire lors du traçage
let forceTraceStartIndex = null; // pour le point de départ du traçage

let history = [];
let future = [];

let hoverPointIndexlame = null; // nouveaux états pour survol en gomme
let hoverLineIndexlame = null;
let hoverOnShapelame = false;

let hoverPointIndexforce = null; // nouveaux états pour survol en gomme
let hoverLineIndexforce = null;
let hoverOnShapeforce = false;

let metalGraph = []; // {neighbors: [{i: ..., weight: ...}], intensity: ...}
let forceSources = []; // {pointIndex, strength}
let tickCounter = 0;

let contacts = []; // pour stocker les contacts entre les formes de lame et de force
let forceSegments = []; // pour stocker les segments de force
let lameSegments = []; // pour stocker les segments de lame

function saveState() { //fonction pour sauvegarder l'état actuel du dessin
  // On utilise JSON.parse(JSON.stringify(...)) pour faire une copie profonde des tableaux
  // afin de ne pas conserver des références aux objets originaux.
  // Cela permet de sauvegarder l'état actuel sans risque de modification ultérieure.
  // Cette technique est couramment utilisée pour créer des snapshots d'état dans les applications de dessin
  // ou d'édition, où l'on souhaite pouvoir revenir en arrière sans affecter les
  // objets originaux.
  // En utilisant cette méthode, on s'assure que chaque état sauvegardé est indépendant
  // et peut être restauré sans interférer avec les modifications futures.
    history.push({
    //arrows: JSON.parse(JSON.stringify(arrows)),
    lamePoints: JSON.parse(JSON.stringify(lamePoints)),
    lameLines: JSON.parse(JSON.stringify(lameLines)),
    forcePoints: JSON.parse(JSON.stringify(forcePoints)),
    forceLines: JSON.parse(JSON.stringify(forceLines)),
    mode, //edition ou simulation
    subMode // le sous-mode d'édition (pointLame,lienLame,pointForce,lienForce, déplacement, gomme)
  });
  if (history.length > 100) history.shift(); // Limite l'historique à 100 états pour éviter une consommation excessive de mémoire
  future = [];
}

function undo() {
  if (history.length > 0) { // Vérifie s'il y a des états précédents à restaurer
    future.push({
      //arrows: JSON.parse(JSON.stringify(arrows)),
      lamePoints: JSON.parse(JSON.stringify(lamePoints)),
      lameLines: JSON.parse(JSON.stringify(lameLines)),
      forcePoints: JSON.parse(JSON.stringify(forcePoints)),
      forceLines: JSON.parse(JSON.stringify(forceLines)),
      mode,
      subMode
    });
    //si on a un historique, on le restaure
    const prev = history.pop();

    //arrows.length = 0;
    lamePoints.length = 0;
    lameLines.length = 0;
    forcePoints.length = 0;
    forceLines.length = 0;

    //prev.arrows.forEach(a => arrows.push(a));
    prev.lamePoints.forEach(p => lamePoints.push(p));
    prev.lameLines.forEach(l => lameLines.push(l));
    prev.forcePoints.forEach(p => forcePoints.push(p));
    prev.forceLines.forEach(l => forceLines.push(l));
    mode = prev.mode;
    subMode = prev.subMode;

    redraw();
  }
}

function redo() {// la meme chose que undo mais dans l'autre sens
  if (future.length > 0) {
    history.push({
      //arrows: JSON.parse(JSON.stringify(arrows)),
      lamePoints: JSON.parse(JSON.stringify(lamePoints)),
      lameLines: JSON.parse(JSON.stringify(lameLines)),
      forcePoints: JSON.parse(JSON.stringify(forcePoints)),
      forceLines: JSON.parse(JSON.stringify(forceLines)),
      mode,
      subMode
    });
    const next = future.pop();

    //arrows.length = 0;
    lamePoints.length = 0;
    lameLines.length = 0;
    forcePoints.length = 0;
    forceLines.length = 0;

    //next.arrows.forEach(a => arrows.push(a));
    next.lamePoints.forEach(p => lamePoints.push(p));
    next.lameLines.forEach(l => lameLines.push(l));
    next.forcePoints.forEach(p => forcePoints.push(p));
    next.forceLines.forEach(l => forceLines.push(l));

    mode = next.mode;
    subMode = next.subMode;

    redraw();
  }
}

function resizeCanvas() {// Ajuste la taille du canvas à la fenêtre
  canvas.width = window.innerWidth * 0.9;
  canvas.height = window.innerHeight * 0.92;
  redraw();
}
window.addEventListener("resize", resizeCanvas);// Écoute l'événement de redimensionnement de la fenêtre pour ajuster le canvas
resizeCanvas();

function drawLameFormes() {
  const adjacency = {};// Crée un objet pour stocker les connexions entre les lamePoints
  for (let i = 0; i < lamePoints.length; i++) adjacency[i] = [];// Initialise un tableau pour chaque point
  for (let [a, b] of lameLines) {// Pour chaque ligne, on ajoute les lamePoints aux connexions
    adjacency[a].push(b); //la fonction push ajoute un élément à la fin du tableau
    adjacency[b].push(a);
  }

  function findCycle(start) {// Fonction pour trouver un cycle à partir d'un point de départ
    const path = [];// Chemin actuel du cycle
    const visited = new Set();// Ensemble pour suivre les lamePoints visités
    function dfs(current, prev) {// Fonction de recherche en profondeur pour explorer les connexions
      path.push(current);// Ajoute le point actuel au chemin
      visited.add(current);// Marque le point actuel comme visité
      for (const neighbor of adjacency[current]) {
        if (neighbor === prev) continue;
        if (neighbor === start && path.length > 2) return true;
        if (!visited.has(neighbor)) {
          if (dfs(neighbor, current)) return true;
        }
      }
      path.pop();
      return false;
    }
    return dfs(start, -1) ? path.slice() : null;// Retourne le chemin trouvé ou null s'il n'y a pas de cycle
  }

  const drawnCycles = new Set();// Ensemble pour éviter de dessiner plusieurs fois le même cycle
  lameShapeNbActuel = 0; // Réinitialise le compteur de formes de lame
  for (let i = 0; i < lamePoints.length; i++) {// Pour chaque point, on cherche un cycle
    const cycle = findCycle(i);// on utilise la fonction findCycle pour trouver les cycles
    if (cycle) {
      const key = [...cycle].sort().join("-");
      if (drawnCycles.has(key)) continue;
      drawnCycles.add(key);

      // Dessiner polygone gris semi-transparent si survol en gomme
      ctx.beginPath();
      const first = lamePoints[cycle[0]];
      ctx.moveTo(first.x, first.y);
      for (let j = 1; j < cycle.length; j++) {
        const pt = lamePoints[cycle[j]];
        ctx.lineTo(pt.x, pt.y);
      }
      ctx.closePath();
      lameShapeNbActuel++;
      
      if (mode === "edition" && subMode === "gomme" && hoverOnShapelame) {
        ctx.fillStyle = "rgba(200,200,200,0.3)";
      } else {
        ctx.fillStyle = "#ccc";
      }
      ctx.fill();
    }
    if (lameShapeNbActuel > lameShapeNbAncien) {
      lameShapeNbAncien = lameShapeNbActuel; // Met à jour l'ancien nombre de formes de lame
      initializeMetalGraph(); // Initialisation du graphe métallique
    } else if (lameShapeNbActuel < lameShapeNbAncien) {
      lameShapeNbAncien = lameShapeNbActuel; // Met à jour l'ancien nombre de formes de lame
      metalGraph = [];
    }
    //console.log('metalGraph', metalGraph);
  }

  // Tracer les lignes avec opacité réduite si survol en gomme
  ctx.strokeStyle = "#999";
  for (let i = 0; i < lameLines.length; i++) {
    const [a, b] = lameLines[i];
    const p1 = lamePoints[a];
    const p2 = lamePoints[b];
    ctx.beginPath();
    ctx.moveTo(p1.x, p1.y);
    ctx.lineTo(p2.x, p2.y);
    if (mode === "edition" && subMode === "gomme" && i === hoverLineIndexlame) {
      ctx.strokeStyle = "rgba(153,153,153,0.3)";
    } else {
      ctx.strokeStyle = "#999";
    }
    ctx.stroke();
  }

  if (lameTempline) {// Si une ligne temporaire est en cours de traçage
    const p1 = lamePoints[lameTempline.start];
    ctx.beginPath();
    ctx.moveTo(p1.x, p1.y);
    ctx.lineTo(mouseX, mouseY);
    ctx.strokeStyle = "black";
    ctx.setLineDash([5, 5]);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  if (mode === "edition") {
    
    lamePoints.forEach((p, i) => {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 8, 0, 2 * Math.PI);
      if (subMode === "gomme" && i === hoverPointIndexlame) {
        ctx.fillStyle = "rgba(0, 0, 255, 0.24)";
      } else {
        ctx.fillStyle = subMode === "gomme" && p.toDelete ? "orange" : "blue";
      }
      ctx.fill();
    });

    if (subMode === "pointLame") {
      ctx.beginPath();
      ctx.arc(mouseX, mouseY, 6, 0, 2 * Math.PI);
      ctx.fillStyle = "#add8e6";
      ctx.fill();
    }

    if (subMode === "lienLame") {
      ctx.beginPath();
      ctx.arc(mouseX, mouseY, 5, 0, 2 * Math.PI);
      ctx.fillStyle = "black";
      ctx.fill();
    }
  }
}

function drawForceFormes() {
  const adjacency = {};
  for (let i = 0; i < forcePoints.length; i++) adjacency[i] = [];
  for (let [a, b] of forceLines) {
    adjacency[a].push(b);
    adjacency[b].push(a);
  }

  function findCycle(start) {// Fonction pour trouver un cycle à partir d'un point de départ
    const path = [];// Chemin actuel du cycle
    const visited = new Set();// Ensemble pour suivre les forcePoints visités
    function dfs(current, prev) {// Fonction de recherche en profondeur pour explorer les connexions
      path.push(current);// Ajoute le point actuel au chemin
      visited.add(current);// Marque le point actuel comme visité
      for (const neighbor of adjacency[current]) {
        if (neighbor === prev) continue;
        if (neighbor === start && path.length > 2) return true;
        if (!visited.has(neighbor)) {
          if (dfs(neighbor, current)) return true;
        }
      }
      path.pop();
      return false;
    }
    return dfs(start, -1) ? path.slice() : null;// Retourne le chemin trouvé ou null s'il n'y a pas de cycle
  }

  const drawnCycles = new Set();// Ensemble pour éviter de dessiner plusieurs fois le même cycle
  forceShapeNb = 0; // Réinitialise le compteur de formes de force
  for (let i = 0; i < forcePoints.length; i++) {// Pour chaque point, on cherche un cycle
    const cycle = findCycle(i);// on utilise la fonction findCycle pour trouver les cycles
    if (cycle) {
      forceShapeNb++;
      const key = [...cycle].sort().join("-");
      if (drawnCycles.has(key)) continue;
      drawnCycles.add(key);

      // Dessiner polygone gris semi-transparent si survol en gomme
      ctx.beginPath();
      const first = forcePoints[cycle[0]];
      ctx.moveTo(first.x, first.y);
      for (let j = 1; j < cycle.length; j++) {
        const pt = forcePoints[cycle[j]];
        ctx.lineTo(pt.x, pt.y);
      }
      ctx.closePath();
      if (mode === "edition" && subMode === "gomme" && hoverOnShapeforce) {
        ctx.fillStyle = "rgba(255, 31, 31, 0.3)";
      } else {
        ctx.fillStyle = "rgba(185, 13, 13, 0.37)";
      }

      //creation de la fleche au centre de la forme si elle n'existe pas deja
      if (forceShapeNb > arrows.length) {
        // Calcul du centroïde du polygone
        let centerX = 0, centerY = 0;
        for (let idx of cycle) {
          centerX += forcePoints[idx].x;
          centerY += forcePoints[idx].y;
        }
        centerX /= cycle.length;
        centerY /= cycle.length;
        
        arrows.push({ startX: centerX, startY: centerY, endX: centerX-50, endY: centerY });
      }

      ctx.fill();
    }
  }

  // Tracer les lignes avec opacité réduite si survol en gomme
  ctx.strokeStyle = "rgba(145, 33, 33, 0.63)";
  for (let i = 0; i < forceLines.length; i++) {
    const [a, b] = forceLines[i];
    const p1 = forcePoints[a];
    const p2 = forcePoints[b];
    ctx.beginPath();
    ctx.moveTo(p1.x, p1.y);
    ctx.lineTo(p2.x, p2.y);
    if (mode === "edition" && subMode === "gomme" && i === hoverLineIndexforce) {
      ctx.strokeStyle = "rgba(124, 42, 42, 0.3)";
    } else {
      ctx.strokeStyle = "rgba(145, 33, 33, 0.63)";
    }
    ctx.stroke();
  }

  if (forceTempline) {// Si une ligne temporaire est en cours de traçage
    const p1 = forcePoints[forceTempline.start];
    ctx.beginPath();
    ctx.moveTo(p1.x, p1.y);
    ctx.lineTo(mouseX, mouseY);
    ctx.strokeStyle = "black";
    ctx.setLineDash([5, 5]);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  if (mode === "edition") {
    forcePoints.forEach((p, i) => {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 8, 0, 2 * Math.PI);
      if (subMode === "gomme" && i === hoverPointIndexforce) {
        ctx.fillStyle = "rgba(255, 0, 0, 0.16)";
      } else {
        ctx.fillStyle = subMode === "gomme" && p.toDelete ? "orange" : "red";
      }
      ctx.fill();
    });

    if (subMode === "pointForce") {
      ctx.beginPath();
      ctx.arc(mouseX, mouseY, 6, 0, 2 * Math.PI);
      ctx.fillStyle = "#e08d8dff";
      ctx.fill();
    }

    if (subMode === "lienForce") {
      ctx.beginPath();
      ctx.arc(mouseX, mouseY, 5, 0, 2 * Math.PI);
      ctx.fillStyle = "black";
      ctx.fill();
    }

    if (forceShapeNb < arrows.length) {
        arrows.splice(forceShapeNb, arrows.length - forceShapeNb); // Supprime les flèches en trop
    }
  }
}

function drawArrow(arrow, index) {
  const { startX, startY, endX, endY } = arrow;
  const dx = endX - startX;
  const dy = endY - startY;
  const length = Math.sqrt(dx * dx + dy * dy);
  const angle = Math.atan2(dy, dx);
  const force = length * 20;
  arrow.force = force;
  const arrowWidth = 5 + length / 50;

  ctx.strokeStyle = "red";
  
  ctx.lineWidth = arrowWidth;
  ctx.beginPath();
  ctx.moveTo(startX, startY);
  ctx.lineTo(endX, endY);
  ctx.stroke();
  ctx.lineWidth = 1;

  const headLength = 10 + (10 * length) / 50;
  ctx.beginPath();
  ctx.moveTo(endX, endY);
  ctx.lineTo(
    endX - headLength * Math.cos(angle - 0.5),
    endY - headLength * Math.sin(angle - 0.5)
  );
  ctx.lineTo(
    endX - headLength * Math.cos(angle + 0.5),
    endY - headLength * Math.sin(angle + 0.5)
  );
  ctx.closePath();
  ctx.fillStyle = "red";
  ctx.fill();

  ctx.fillStyle = "black";
  ctx.font = "14px sans-serif";
  ctx.fillText(`${Math.round(force)} N`, startX + dx / 2, startY + dy / 2 - 10);

  if (mode === "edition" && subMode === "deplacement") {
    ctx.beginPath();
    ctx.arc(startX, startY, 7, 0, 2 * Math.PI);
    ctx.fillStyle = "orange";
    ctx.fill();
    ctx.beginPath();
    ctx.arc(endX, endY, 7, 0, 2 * Math.PI);
    ctx.fillStyle = "orange";
    ctx.fill();
  }
}

function drawDiffusion() {
  simulateDiffusionTick();  // Appelle la fonction de simulation de diffusion à chaque frame
  
  for (let i = 0; i < lameLines.length; i++) {
    
    const [a, b] = lameLines[i];
    
    if (metalGraph.length === 0) continue; // continue signifie passer à l'itération suivante, n'execute pas le reste du code dans la boucle pour cette itération
    const intensity = (metalGraph[a].intensity + metalGraph[b].intensity) / 2;
    //console.log('metalGraph', metalGraph);
    //console.log('intensity', intensity);
    if (intensity < 0.01) continue;
    
    const p1 = lamePoints[a];
    const p2 = lamePoints[b];
    const midX = (p1.x + p2.x) / 2;
    const midY = (p1.y + p2.y) / 2;
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const len = Math.hypot(dx, dy);
    const normX = dx / len;
    const normY = dy / len;

    const arrowLength = 20 + intensity * 30;
    const arrowWidth = 2 + intensity * 5;
    ctx.strokeStyle = `rgba(0, 120, 255, ${Math.min(1, intensity)})`;
    ctx.lineWidth = arrowWidth;

    ctx.beginPath();
    ctx.moveTo(midX, midY);
    ctx.lineTo(midX + normX * arrowLength, midY + normY * arrowLength);
    ctx.stroke();
    
  }
  requestAnimationFrame(drawDiffusion); // Redessine à chaque frame pour l'animation
}

function drawButtons() {
  ctx.fillStyle = mode === "edition" ? "#007bff" : "#6c757d";
  ctx.fillRect(20, 20, 100, 30);
  ctx.fillStyle = "white";
  ctx.fillText("Édition", 40, 40);

  ctx.fillStyle = mode === "simulation" ? "#007bff" : "#6c757d";
  ctx.fillRect(130, 20, 110, 30);
  ctx.fillStyle = "white";
  ctx.fillText("Simulation", 150, 40);

  if (mode === "edition") {
    const modes = [
      { label: "Ajouter Point Lame", value: "pointLame" },
      { label: "Tracer Lien Lame", value: "lienLame" },
      { label: "Ajouter Point Force", value: "pointForce" },
      { label: "Tracer Lien Force", value: "lienForce" },
      { label: "Déplacer", value: "deplacement" },
      { label: "Gomme", value: "gomme" },
    ];

    modes.forEach((m, i) => {
      ctx.fillStyle = subMode === m.value ? "#17a2b8" : "#6c757d";
      ctx.fillRect(20, 60 + i * 40, 140, 30);
      ctx.fillStyle = "white";
      ctx.fillText(m.label, 30, 80 + i * 40);
    });

  }

  ctx.fillStyle = "#ffc107";
  ctx.fillRect(canvas.width / 2 - 60, 20, 50, 30);
  ctx.fillStyle = "black";
  ctx.fillText("↺", canvas.width / 2 - 45, 42);

  ctx.fillStyle = "#ffc107";
  ctx.fillRect(canvas.width / 2 + 10, 20, 50, 30);
  ctx.fillStyle = "black";
  ctx.fillText("↻", canvas.width / 2 + 25, 42);
}

function redraw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawLameFormes();
  drawForceFormes();
  arrows.forEach(drawArrow);
  drawButtons();
}

function isPointInPolygon(px, py, polygonPoints) {
  let inside = false;
  for (let i = 0, j = polygonPoints.length - 1; i < polygonPoints.length; j = i++) {
    const xi = polygonPoints[i].x, yi = polygonPoints[i].y;
    const xj = polygonPoints[j].x, yj = polygonPoints[j].y;

    const intersect = ((yi > py) !== (yj > py)) &&
                      (px < ((xj - xi) * (py - yi)) / (yj - yi + 0.00001) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

function pointLineDistance(px, py, x1, y1, x2, y2) {
  const A = px - x1;
  const B = py - y1;
  const C = x2 - x1;
  const D = y2 - y1;

  const dot = A * C + B * D;
  const len_sq = C * C + D * D;
  let param = -1;
  if (len_sq !== 0) param = dot / len_sq;

  let xx, yy;

  if (param < 0) {
    xx = x1;
    yy = y1;
  } else if (param > 1) {
    xx = x2;
    yy = y2;
  } else {
    xx = x1 + param * C;
    yy = y1 + param * D;
  }

  const dx = px - xx;
  const dy = py - yy;
  return Math.sqrt(dx * dx + dy * dy);
}

function moveShape(shape, dx, dy) {
  if (shape === "lame") {
    lamePoints.forEach(p => {
      p.x += dx;
      p.y += dy;
    });

  } else if (shape === "force") {
    forcePoints.forEach(p => {
      p.x += dx;
      p.y += dy;
    });
    arrows.forEach(arr => {
      arr.startX += dx;
      arr.startY += dy;
      arr.endX += dx;
      arr.endY += dy;
    });
  }

  
  redraw();
}

canvas.addEventListener("mousemove", (e) => {
  const rect = canvas.getBoundingClientRect();
  mouseX = e.clientX - rect.left;
  mouseY = e.clientY - rect.top;

  // Gestion du déplacement de la forme complète lame
  if (draggingShapelame) {
    if (typeof draggingShapelame === "object") {
      const dx = mouseX - draggingShapelame.prevX;
      const dy = mouseY - draggingShapelame.prevY;
      moveShape("lame",dx, dy);
      draggingShapelame.prevX = mouseX;
      draggingShapelame.prevY = mouseY;
    } else if (draggingShapelame === true) {
      draggingShapelame = { prevX: mouseX, prevY: mouseY };
    }
    redraw();
    return;  // On arrête ici car priorité au drag forme
  }
  // Gestion du déplacement de la forme complète force
  if (draggingShapeforce) {
    if (typeof draggingShapeforce === "object") {
      const dx = mouseX - draggingShapeforce.prevX;
      const dy = mouseY - draggingShapeforce.prevY;
      moveShape("force",dx, dy);
      draggingShapeforce.prevX = mouseX;
      draggingShapeforce.prevY = mouseY;
    } else if (draggingShapeforce === true) {
      draggingShapeforce = { prevX: mouseX, prevY: mouseY };
    }
    redraw();
    return;  // On arrête ici car priorité au drag forme
  }

  if (mode === "edition") {
    if (subMode === "gomme") {
      // Survol point lame ?
      for (let i = 0; i < lamePoints.length; i++) {
        if (Math.hypot(mouseX - lamePoints[i].x, mouseY - lamePoints[i].y) < 10) {
          hoverPointIndexlame = i;
          break;
        } else {
          hoverPointIndexlame = null; // Reset if not hovering
        }
      }
      // Survol ligne lame ?
      if (hoverPointIndexlame === null) {
        for (let i = 0; i < lameLines.length; i++) {
          const [a, b] = lameLines[i];
          const p1 = lamePoints[a];
          const p2 = lamePoints[b];
          if (pointLineDistance(mouseX, mouseY, p1.x, p1.y, p2.x, p2.y) < 8) {
            hoverLineIndexlame = i;
            break;
          } else {
            hoverLineIndexlame = null; // Reset if not hovering
          }
        }
      }
      // Survol forme grise lame ? (polygone)
      if (hoverPointIndexlame === null && hoverLineIndexlame === null) {
        const adjacency = {};
        for (let i = 0; i < lamePoints.length; i++) adjacency[i] = [];
        for (let [a, b] of lameLines) {
          adjacency[a].push(b);
          adjacency[b].push(a);
        }
        function findCycle(start) {
          const path = [];
          const visited = new Set();
          function dfs(current, prev) {
            path.push(current);
            visited.add(current);
            for (const neighbor of adjacency[current]) {
              if (neighbor === prev) continue;
              if (neighbor === start && path.length > 2) return true;
              if (!visited.has(neighbor)) {
                if (dfs(neighbor, current)) return true;
              }
            }
            path.pop();
            return false;
          }
          return dfs(start, -1) ? path.slice() : null;
        }
        for (let i = 0; i < lamePoints.length; i++) {
          const cycle = findCycle(i);
          if (cycle) {
            ctx.beginPath();
            const first = lamePoints[cycle[0]];
            ctx.moveTo(first.x, first.y);
            for (let j = 1; j < cycle.length; j++) {
              const pt = lamePoints[cycle[j]];
              ctx.lineTo(pt.x, pt.y);
            }
            ctx.closePath();
            if (ctx.isPointInPath(mouseX, mouseY)) {
              hoverOnShapelame = true;
              break;
            } else {
              hoverOnShapelame = false; // Reset if not hovering
            }
          }
        }
      }

      // Survol point force ?
      for (let i = 0; i < forcePoints.length; i++) {
        if (Math.hypot(mouseX - forcePoints[i].x, mouseY - forcePoints[i].y) < 10) {
          hoverPointIndexforce = i;
          break;
        } else {
          hoverPointIndexforce = null; // Reset if not hovering
        }
      }
      // Survol ligne force ?
      if (hoverPointIndexforce === null) {
        for (let i = 0; i < forceLines.length; i++) {
          const [a, b] = forceLines[i];
          const p1 = forcePoints[a];
          const p2 = forcePoints[b];
          if (pointLineDistance(mouseX, mouseY, p1.x, p1.y, p2.x, p2.y) < 8) {
            hoverLineIndexforce = i;
            break;
          } else {
            hoverLineIndexforce = null; // Reset if not hovering
          }
        }
      }
      // Survol forme grise force ? (polygone)
      if (hoverPointIndexforce === null && hoverLineIndexforce === null) {
        const adjacency = {};
        for (let i = 0; i < forcePoints.length; i++) adjacency[i] = [];
        for (let [a, b] of forceLines) {
          adjacency[a].push(b);
          adjacency[b].push(a);
        }
        function findCycle(start) {
          const path = [];
          const visited = new Set();
          function dfs(current, prev) {
            path.push(current);
            visited.add(current);
            for (const neighbor of adjacency[current]) {
              if (neighbor === prev) continue;
              if (neighbor === start && path.length > 2) return true;
              if (!visited.has(neighbor)) {
                if (dfs(neighbor, current)) return true;
              }
            }
            path.pop();
            return false;
          }
          return dfs(start, -1) ? path.slice() : null;
        }
        for (let i = 0; i < forcePoints.length; i++) {
          const cycle = findCycle(i);
          if (cycle) {
            ctx.beginPath();
            const first = forcePoints[cycle[0]];
            ctx.moveTo(first.x, first.y);
            for (let j = 1; j < cycle.length; j++) {
              const pt = forcePoints[cycle[j]];
              ctx.lineTo(pt.x, pt.y);
            }
            ctx.closePath();
            if (ctx.isPointInPath(mouseX, mouseY)) {
              hoverOnShapeforce = true;
              break;
            } else {
              hoverOnShapeforce = false; // Reset if not hovering
            }
          }
        }
      }

     
    }
  }

  if (mode === "edition" && subMode === "deplacement") {
    if (draggingPointIndexlame !== null) {
      lamePoints[draggingPointIndexlame].x = mouseX;
      lamePoints[draggingPointIndexlame].y = mouseY;
      redraw();
      return;
    }
    if (draggingPointIndexforce !== null) {
      forcePoints[draggingPointIndexforce].x = mouseX;
      forcePoints[draggingPointIndexforce].y = mouseY;
      redraw();
      return;
    }

    if (draggingArrowPoint !== null) {
      const arr = arrows[draggingArrow];
      if (draggingArrowPoint === "start") {
        arr.startX = mouseX;
        arr.startY = mouseY;
      } else if (draggingArrowPoint === "end") {
        arr.endX = mouseX;
        arr.endY = mouseY;
      }
      redraw();
      return;
    }
    if (draggingArrow !== null) {
      const arr = arrows[draggingArrow];
      const dx = mouseX - arr._dragPrevX;
      const dy = mouseY - arr._dragPrevY;
      arr.startX += dx;
      arr.startY += dy;
      arr.endX += dx;
      arr.endY += dy;
      arr._dragPrevX = mouseX;
      arr._dragPrevY = mouseY;
      redraw();
      return;
    }
  }

  redraw();
});

canvas.addEventListener("mousedown", (e) => {
  const rect = canvas.getBoundingClientRect();
  const mx = e.clientX - rect.left;
  const my = e.clientY - rect.top;
  //console.log("mousedown at", mx, my);

  // Undo
  const undoX = canvas.width / 2 - 60;
  const redoX = canvas.width / 2 + 10;

  if (mx >= undoX && mx <= undoX + 50 && my >= 20 && my <= 50) { // Undo
    //console.log("Undo clicked");
    undo();
    return;
  }
  if (mx >= redoX && mx <= redoX + 50 && my >= 20 && my <= 50) { // Redo
    //console.log("Redo clicked");
    redo();
    return;
  }

  if (mx >= 20 && mx <= 120 && my >= 20 && my <= 50) { // Bouton Edition
    mode = "edition";
    subMode = null;
    lameTempline = null;
    lameTraceStartIndex = null;
    forceTempline = null;
    forceTraceStartIndex = null;
    redraw();
    return;
  }
  if (mx >= 130 && mx <= 240 && my >= 20 && my <= 50) { // Bouton Simulation
    mode = "simulation";
    subMode = null;
    lameTempline = null;
    lameTraceStartIndex = null;
    forceTempline = null;
    forceTraceStartIndex = null;
    creationInstant();
    redraw();

    return;
  }

  if (mode === "edition") { // boutons de sous-modes
    const buttonHeight = 30;
    const buttonSpacing = 40;
    const buttonStartY = 60;
    const modes = ["pointLame", "lienLame","pointForce","lienForce", "deplacement", "gomme"];
    for (let i = 0; i < modes.length; i++) {
      if (mx >= 20 && mx <= 160 && my >= buttonStartY + i * buttonSpacing && my <= buttonStartY + i * buttonSpacing + buttonHeight) {
        subMode = modes[i];
        lameTempline = null;
        lameTraceStartIndex = null;
        forceTempline = null;
        forceTraceStartIndex = null;
        redraw();
        return;
      }
    }

    

    if (subMode === "pointLame") { // Ajouter un point lame
      saveState();
      lamePoints.push({ x: mx, y: my });
      redraw();
      return;
    }
    if (subMode === "lienLame") { // Tracer une ligne entre deux points lame
      // Recherche point proche
      let closePointIndex = null;
      for (let i = 0; i < lamePoints.length; i++) {
        if (Math.hypot(lamePoints[i].x - mx, lamePoints[i].y - my) < 15) {
          closePointIndex = i;
          break;
        }
      }
      if (closePointIndex !== null) {
        if (lameTraceStartIndex === null) {
          lameTraceStartIndex = closePointIndex;
          lameTempline = { start: closePointIndex };
          redraw();
          return;
        } else if (lameTraceStartIndex !== closePointIndex) {
          saveState();
          lameLines.push([lameTraceStartIndex, closePointIndex]);
          lameTempline = null;
          lameTraceStartIndex = null;
          redraw();
          return;
        }
      }
    }

    if (subMode === "pointForce") { // Ajouter un point force
      saveState();
      forcePoints.push({ x: mx, y: my });
      redraw();
      return;
    }
    if (subMode === "lienForce") { // Tracer une ligne entre deux points force
      // Recherche point proche
      let closePointIndex = null;
      for (let i = 0; i < forcePoints.length; i++) {
        if (Math.hypot(forcePoints[i].x - mx, forcePoints[i].y - my) < 15) {
          closePointIndex = i;
          break;
        }
      }
      if (closePointIndex !== null) {
        if (forceTraceStartIndex === null) {
          forceTraceStartIndex = closePointIndex;
          forceTempline = { start: closePointIndex };
          redraw();
          return;
        } else if (forceTraceStartIndex !== closePointIndex) {
          saveState();
          forceLines.push([forceTraceStartIndex, closePointIndex]);
          forceTempline = null;
          forceTraceStartIndex = null;
          redraw();
          return;
        }
      }
    }

    if (subMode === "deplacement") { // Déplacement de points ou formes
      // Détecter point proche lame
      for (let i = 0; i < lamePoints.length; i++) {
        if (Math.hypot(lamePoints[i].x - mx, lamePoints[i].y - my) < 10) {
          draggingPointIndexlame = i;
          saveState();
          return;
        }
      }
      // Détecter point proche force
      for (let i = 0; i < forcePoints.length; i++) {
        if (Math.hypot(forcePoints[i].x - mx, forcePoints[i].y - my) < 10) {
          draggingPointIndexforce = i;
          saveState();
          return;
        }
      }

      // Détecter flèche
      for (let i = 0; i < arrows.length; i++) {
        const arr = arrows[i];
        if (Math.hypot(arr.startX - mx, arr.startY - my) < 10) {
          draggingArrow = i;
          draggingArrowPoint = "start";
          arr._dragPrevX = mx;
          arr._dragPrevY = my;
          saveState();
          return;
        }
        if (Math.hypot(arr.endX - mx, arr.endY - my) < 10) {
          draggingArrow = i;
          draggingArrowPoint = "end";
          arr._dragPrevX = mx;
          arr._dragPrevY = my;
          saveState();
          return;
        }
      }
      // Déplacer flèche complète
      for (let i = 0; i < arrows.length; i++) {
        const arr = arrows[i];
        if (pointLineDistance(mx, my, arr.startX, arr.startY, arr.endX, arr.endY) < 10) {
          draggingArrow = i;
          draggingArrowPoint = null;
          arr._dragPrevX = mx;
          arr._dragPrevY = my;
          saveState();
          return;
        }
      }

      // Déplacer forme complète lame
      if (isPointInPolygon(mx, my, lamePoints)) {
        draggingShapelame = true;
      } else {
        draggingShapelame = null; // Reset if not hovering
      }
      // Déplacer forme complète force
      if (isPointInPolygon(mx, my, forcePoints)) {
        draggingShapeforce = true;
      } else {
        draggingShapeforce = null; // Reset if not hovering
      }

      saveState();
      return;
    }

    if (subMode === "gomme") {
      // Supprimer point survolé lame
      for (let i = 0; i < lamePoints.length; i++) {
        if (Math.hypot(lamePoints[i].x - mx, lamePoints[i].y - my) < 10) {
          saveState();
          lamePoints.splice(i, 1);
          // Supprimer lignes liées
          lameLines = lameLines.filter(l => l[0] !== i && l[1] !== i);
          // Recalibrer indices des lignes
          lameLines = lameLines.map(([a, b]) => [
            a > i ? a - 1 : a,
            b > i ? b - 1 : b
          ]);
          redraw();
          return;
        }
      }
      // Supprimer point survolé force
      for (let i = 0; i < forcePoints.length; i++) {
        if (Math.hypot(forcePoints[i].x - mx, forcePoints[i].y - my) < 10) {
          saveState();
          forcePoints.splice(i, 1);
          // Supprimer lignes liées
          forceLines = forceLines.filter(l => l[0] !== i && l[1] !== i);
          // Recalibrer indices des lignes
          forceLines = forceLines.map(([a, b]) => [
            a > i ? a - 1 : a,
            b > i ? b - 1 : b
          ]);
          redraw();
          return;
        }
      }
      // Supprimer ligne survolée lame
      for (let i = 0; i < lameLines.length; i++) {
        const [a, b] = lameLines[i];
        const p1 = lamePoints[a];
        const p2 = lamePoints[b];
        if (pointLineDistance(mx, my, p1.x, p1.y, p2.x, p2.y) < 8) {
          saveState();
          lameLines.splice(i, 1);
          redraw();
          return;
        }
      }
      // Supprimer ligne survolée force
      for (let i = 0; i < forceLines.length; i++) {
        const [a, b] = forceLines[i];
        const p1 = forcePoints[a];
        const p2 = forcePoints[b];
        if (pointLineDistance(mx, my, p1.x, p1.y, p2.x, p2.y) < 8) {
          saveState();
          forceLines.splice(i, 1);
          redraw();
          return;
        }
      }
    
    }
  }
});

canvas.addEventListener("mouseup", (e) => {
  draggingPointIndexlame = null;
  draggingShapelame = null;
  draggingPointIndexforce = null;
  draggingShapeforce = null;
  draggingArrow = null;
  draggingArrowPoint = null;
  //initializeMetalGraph(); // Initialisation du graphe métallique
});

function initializeMetalGraph() {
  metalGraph = lamePoints.map(() => ({
    neighbors: [],
    intensity: 0 // force reçue
  }));

  for (let [a, b] of lameLines) {
    const dx = lamePoints[a].x - lamePoints[b].x;
    const dy = lamePoints[a].y - lamePoints[b].y;
    const distance = Math.hypot(dx, dy);
    const thickness = 3; // cm — peut varier plus tard
    const weight = thickness / distance; // Plus le métal est épais, plus la diffusion est lente

    metalGraph[a].neighbors.push({ i: b, weight });
    metalGraph[b].neighbors.push({ i: a, weight });
  }
  
}

function simulateDiffusionTick() {
  tickCounter++;
  if (tickCounter < 60) return;
  tickCounter = 0;  
  //console.log('diffusion');
  const contacts = detectContactsBetweenSegments(forceSegments, lameSegments, 1000);

  console.log("Contacts détectés :", contacts);
  
  // 1. Mise à jour des intensités à partir des points de contact
  for (const pt of contacts) {
    console.log("a", contacts)
    let minDist = Infinity;
    let nearestIndex = -1;
    for (let i = 0; i < lamePoints.length; i++) {
      const p = lamePoints[i];
      const d = Math.hypot(pt.x - p.x, pt.y - p.y);
      if (d < minDist) {
        minDist = d;
        nearestIndex = i;
      }
    }
    console.log("b", nearestIndex)
    if (nearestIndex !== -1) {
      metalGraph[nearestIndex].intensity += 1.0; // à moduler par l'angle ou autre
      
    }
  }

  // 2. Diffusion de l’intensité dans le graphe
  const newIntensities = new Array(metalGraph.length).fill(0);

  for (let i = 0; i < metalGraph.length; i++) {
    const neighbors = metalGraph[i].neighbors;
    let total = 0;
    let weightSum = 0;

    for (const neighbor of neighbors) {
      total += metalGraph[neighbor.i].intensity * neighbor.weight;
      weightSum += neighbor.weight;
    }

    if (weightSum > 0) {
      newIntensities[i] = total / weightSum;
    } else {
      newIntensities[i] = metalGraph[i].intensity;
    }
  }

  // 3. Mise à jour des intensités
  for (let i = 0; i < metalGraph.length; i++) {
    metalGraph[i].intensity = newIntensities[i];
  }
}

function projectPointOnSegment(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  if (dx === 0 && dy === 0) return { x: x1, y: y1, onSegment: true };

  const t = ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy);
  const tClamped = Math.max(0, Math.min(1, t));

  return {
    x: x1 + tClamped * dx,
    y: y1 + tClamped * dy,
    t: tClamped,
    onSegment: tClamped >= 0 && tClamped <= 1
  };
}

function detectContactsBetweenSegments(forceSegments, lameSegments, seuil = 10) {
  const contacts = [];

  for (const fSeg of forceSegments) {
    const [fP1, fP2] = fSeg;

    // Pour mieux détecter, on peut échantillonner plusieurs points le long du segment force
    const nbSamples = 5;
    for (let i = 0; i <= nbSamples; i++) {
      const tSample = i / nbSamples;
      const samplePoint = {
        x: fP1.x + tSample * (fP2.x - fP1.x),
        y: fP1.y + tSample * (fP2.y - fP1.y)
      };

      for (const lSeg of lameSegments) {
        const [lP1, lP2] = lSeg;
        const proj = projectPointOnSegment(samplePoint.x, samplePoint.y, lP1.x, lP1.y, lP2.x, lP2.y);
        const dist = Math.hypot(samplePoint.x - proj.x, samplePoint.y - proj.y);

        if (dist < seuil) {
          contacts.push({ x: proj.x, y: proj.y });
        }
      }
    }
  }

  return contacts;
}

function creationInstant() {
  // Création de la forme de lame
  lamePoints = [
    { x: 100, y: 300 },
    { x: 200, y: 300 },
    { x: 200, y: 700 },
    { x: 100, y: 700 }
  ];
  lameLines = [[0, 1], [1, 2], [2, 3], [3, 0]];
  
  // Création de la forme de force
  forcePoints = [
    { x: 300, y: 400 },
    { x: 400, y: 400 },
    { x: 400, y: 500 },
    { x: 300, y: 500 }
  ];
  forceLines = [[0, 1], [1, 2], [2, 3], [3, 0]];
  
}

requestAnimationFrame(drawDiffusion);
// Initial state save
saveState();
redraw();

//la suite du projet est de rajouter des fleches de force dans les polygone de force les fleches leur seront donc lié
//on pourras choisir le type de force (N, m/s, km/h ) et ca valeur
//on choisit la direction de la force en tournant la fleche
//par la suite, la simulation c'est :
//la "collision" entre le polygone de force selon la fleche de force et les polygones de lame
//les "collisions" seront represantées par des fleches de force internes aux polygones de lame (simuler au plus proche de la réalité)
