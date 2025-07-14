const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");

// Données principales
let arrows = [];
let points = [  // points partagés par tous les triangles
  { x: 300, y: 200 },
  { x: 400, y: 250 },
  { x: 300, y: 300 },
];
let triangles = [
  [0, 1, 2], // indices dans points
];

// États de drag & mode
let mode = "simulation";

let draggingPoint = null;        // { pointIndex, triangleIndex, start/end ? } ou null
let draggingArrowPoint = null;   // { arrow, "start"/"end" }
let draggingArrow = null;        // { arrow, offsetX, offsetY }
let draggingTriangle = null;     // index du triangle déplacé
let draggingTriangleOffset = null; // { dx, dy }
let hoverFusionTarget = null;    // index point proche pour fusion

// Undo/Redo
let history = [];
let future = [];

function saveState() {
  history.push({
    arrows: JSON.parse(JSON.stringify(arrows)),
    points: JSON.parse(JSON.stringify(points)),
    triangles: JSON.parse(JSON.stringify(triangles)),
  });
  if (history.length > 100) history.shift();
  future = [];
}

function undo() {
  if (history.length === 0) return;
  future.push({
    arrows: JSON.parse(JSON.stringify(arrows)),
    points: JSON.parse(JSON.stringify(points)),
    triangles: JSON.parse(JSON.stringify(triangles)),
  });
  const prev = history.pop();
  arrows = prev.arrows;
  points = prev.points;
  triangles = prev.triangles;
  redraw();
}

function redo() {
  if (future.length === 0) return;
  history.push({
    arrows: JSON.parse(JSON.stringify(arrows)),
    points: JSON.parse(JSON.stringify(points)),
    triangles: JSON.parse(JSON.stringify(triangles)),
  });
  const next = future.pop();
  arrows = next.arrows;
  points = next.points;
  triangles = next.triangles;
  redraw();
}

function resizeCanvas() {
  canvas.width = window.innerWidth * 0.9;
  canvas.height = window.innerHeight * 0.92;
  redraw();
}
window.addEventListener("resize", resizeCanvas);
resizeCanvas();

// Utils
function distance(x1, y1, x2, y2) {
  return Math.hypot(x2 - x1, y2 - y1);
}
function pointNearLine(px, py, startX, startY, endX, endY) {
  // distance point-segment
  const A = { x: startX, y: startY };
  const B = { x: endX, y: endY };
  const ABx = B.x - A.x;
  const ABy = B.y - A.y;
  const APx = px - A.x;
  const APy = py - A.y;
  const ab2 = ABx * ABx + ABy * ABy;
  const ap_ab = APx * ABx + APy * ABy;
  const t = Math.max(0, Math.min(1, ap_ab / ab2));
  const closestX = A.x + t * ABx;
  const closestY = A.y + t * ABy;
  return Math.hypot(px - closestX, py - closestY);
}
function pointInTrash(x, y) {
  const trashX = canvas.width * 0.8;
  return x > trashX;
}

// Dessin

function drawTriangles() {
  triangles.forEach((tri, triIndex) => {
    ctx.fillStyle = "#999";
    ctx.beginPath();
    ctx.moveTo(points[tri[0]].x, points[tri[0]].y);
    ctx.lineTo(points[tri[1]].x, points[tri[1]].y);
    ctx.lineTo(points[tri[2]].x, points[tri[2]].y);
    ctx.closePath();
    ctx.fill();

    if (mode === "edition") {
      // points du triangle
      tri.forEach(pIndex => {
        let color = "blue";
        if (draggingPoint && draggingPoint.pointIndex === pIndex) {
          color = "deepskyblue";
        } else if (hoverFusionTarget === pIndex) {
          color = "lightblue";
        }
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(points[pIndex].x, points[pIndex].y, 8, 0, 2 * Math.PI);
        ctx.fill();
      });
    }
  });
}

function drawArrow(arrow) {
  const { startX, startY, endX, endY } = arrow;
  const dx = endX - startX;
  const dy = endY - startY;
  const length = Math.sqrt(dx * dx + dy * dy);
  const angle = Math.atan2(dy, dx);
  const force = length * 20;
  arrow.force = force;
  const arrowWidth = 5 + length / 50;

  ctx.strokeStyle = arrow.isOverTrash ? "#ff8080" : "red";
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
  ctx.fillStyle = arrow.isOverTrash ? "#ff8080" : "red";
  ctx.fill();

  ctx.fillStyle = "black";
  ctx.font = "14px sans-serif";
  ctx.fillText(`${Math.round(force)} N`, startX + dx / 2, startY + dy / 2 - 10);
}

function drawButtons() {
  // Mode Edition
  ctx.fillStyle = mode === "edition" ? "#007bff" : "#6c757d";
  ctx.fillRect(20, 20, 100, 30);
  ctx.fillStyle = "white";
  ctx.fillText("Édition", 40, 40);

  // Mode Simulation
  ctx.fillStyle = mode === "simulation" ? "#007bff" : "#6c757d";
  ctx.fillRect(130, 20, 110, 30);
  ctx.fillStyle = "white";
  ctx.fillText("Simulation", 150, 40);

  // Ajouter triangle (visible seulement en édition)
  if (mode === "edition") {
    ctx.fillStyle = "#17a2b8";
    ctx.fillRect(20, 60, 140, 30);
    ctx.fillStyle = "white";
    ctx.fillText("Ajouter triangle", 30, 80);
  }

  // Ajouter flèche (toujours visible)
  ctx.fillStyle = "#28a745";
  ctx.fillRect(canvas.width * 0.7, 20, 110, 30);
  ctx.fillStyle = "white";
  ctx.font = "16px sans-serif";
  ctx.fillText("Ajouter Fleche", canvas.width * 0.7 + 10, 40);
  ctx.fillStyle = "black";
  ctx.fillText(`(${arrows.length})`, canvas.width * 0.7 + 120, 40);

  // Undo
  ctx.fillStyle = "#ffc107";
  ctx.fillRect(canvas.width / 2 - 60, 20, 50, 30);
  ctx.fillStyle = "black";
  ctx.fillText("↺", canvas.width / 2 - 45, 42);

  // Redo
  ctx.fillStyle = "#ffc107";
  ctx.fillRect(canvas.width / 2 + 10, 20, 50, 30);
  ctx.fillStyle = "black";
  ctx.fillText("↻", canvas.width / 2 + 25, 42);

  // Poubelle
  const trashX = canvas.width * 0.8;
  const trashWidth = canvas.width * 0.2;
  ctx.globalAlpha = 0.5;
  ctx.fillStyle = "#dc3545";
  ctx.fillRect(trashX, 0, trashWidth, canvas.height);
  ctx.globalAlpha = 1;
  ctx.fillStyle = "white";
  ctx.fillText("🗑️ Poubelle", trashX + 10, 40);
}

function redraw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawTriangles();
  arrows.forEach(drawArrow);
  drawButtons();
}

// Gestion événements

canvas.addEventListener("mousedown", e => {
  const rect = canvas.getBoundingClientRect();
  const mx = e.clientX - rect.left;
  const my = e.clientY - rect.top;

  // Boutons mode Edition / Simulation
  if (mx >= 20 && mx <= 120 && my >= 20 && my <= 50) {
    mode = "edition";
    redraw();
    return;
  }
  if (mx >= 130 && mx <= 240 && my >= 20 && my <= 50) {
    mode = "simulation";
    redraw();
    return;
  }

  // Undo/Redo
  const undoX = canvas.width / 2 - 60;
  const redoX = canvas.width / 2 + 10;
  if (mx >= undoX && mx <= undoX + 50 && my >= 20 && my <= 50) {
    undo();
    return;
  }
  if (mx >= redoX && mx <= redoX + 50 && my >= 20 && my <= 50) {
    redo();
    return;
  }

  // Ajouter triangle (mode edition)
  if (mode === "edition" && mx >= 20 && mx <= 160 && my >= 60 && my <= 90) {
    saveState();
    // Ajoute un triangle avec 3 nouveaux points (décalés pour pas chevaucher)
    const baseX = 350;
    const baseY = 250;
    const n = points.length;
    points.push({ x: baseX, y: baseY });
    points.push({ x: baseX + 50, y: baseY + 20 });
    points.push({ x: baseX, y: baseY + 50 });
    triangles.push([n, n+1, n+2]);
    redraw();
    return;
  }

  // Ajouter flèche (toujours visible)
  if (mx >= canvas.width * 0.7 && mx <= canvas.width * 0.7 + 110 && my >= 20 && my <= 50) {
    saveState();
    arrows.push({
      startX: 350,
      startY: 250,
      endX: 400,
      endY: 250,
      force: 0,
      isOverTrash: false,
    });
    redraw();
    return;
  }

  if (mode === "edition") {
    // Cherche point proche pour drag
    for (let triIndex=0; triIndex < triangles.length; triIndex++) {
      for (let i=0; i<3; i++) {
        const pIndex = triangles[triIndex][i];
        const p = points[pIndex];
        if (distance(mx, my, p.x, p.y) < 8) {
          saveState();
          draggingPoint = { pointIndex: pIndex, triIndex, vertexIndex: i };
          return;
        }
      }
    }
    // Sinon, cherche si clic dans un triangle pour drag entier
    for (let triIndex=0; triIndex < triangles.length; triIndex++) {
      const tri = triangles[triIndex];
      if (pointInTriangle({x: mx, y: my}, tri)) {
        saveState();
        draggingTriangle = triIndex;
        draggingTriangleOffset = { dx: mx, dy: my };
        return;
      }
    }
  } else if (mode === "simulation") {
    // Flèche : extrémités ou corps
    for (const arrow of arrows) {
      if (distance(mx, my, arrow.startX, arrow.startY) < 10) {
        saveState();
        draggingArrowPoint = { arrow, point: "start" };
        return;
      }
      if (distance(mx, my, arrow.endX, arrow.endY) < 10) {
        saveState();
        draggingArrowPoint = { arrow, point: "end" };
        return;
      }
      if (pointNearLine(mx, my, arrow.startX, arrow.startY, arrow.endX, arrow.endY)) {
        saveState();
        draggingArrow = { arrow, offsetX: mx - arrow.startX, offsetY: my - arrow.startY };
        return;
      }
    }
  }
});

canvas.addEventListener("mousemove", e => {
  const rect = canvas.getBoundingClientRect();
  const mx = e.clientX - rect.left;
  const my = e.clientY - rect.top;

  if (mode === "edition") {
    if (draggingPoint) {
      // Drag d'un point
      points[draggingPoint.pointIndex].x = mx;
      points[draggingPoint.pointIndex].y = my;

      // Cherche fusion avec autre point proche (différent)
      hoverFusionTarget = null;
      for (let i = 0; i < points.length; i++) {
        if (i !== draggingPoint.pointIndex && distance(mx, my, points[i].x, points[i].y) < 15) {
          hoverFusionTarget = i;
          break;
        }
      }
      redraw();
      return;
    }
    if (draggingTriangle !== null) {
      // Drag entier triangle
      const tri = triangles[draggingTriangle];
      const dx = mx - draggingTriangleOffset.dx;
      const dy = my - draggingTriangleOffset.dy;
      tri.forEach(pIndex => {
        points[pIndex].x += dx;
        points[pIndex].y += dy;
      });
      draggingTriangleOffset = { dx: mx, dy: my };
      redraw();
      return;
    }
  } else if (mode === "simulation") {
    if (draggingArrowPoint) {
      draggingArrowPoint.arrow[draggingArrowPoint.point + "X"] = mx;
      draggingArrowPoint.arrow[draggingArrowPoint.point + "Y"] = my;
      redraw();
      return;
    }
    if (draggingArrow) {
      const arrow = draggingArrow.arrow;
      const dx = mx - arrow.startX - draggingArrow.offsetX;
      const dy = my - arrow.startY - draggingArrow.offsetY;
      arrow.startX += dx;
      arrow.startY += dy;
      arrow.endX += dx;
      arrow.endY += dy;

      const trashX = canvas.width * 0.8;
      arrow.isOverTrash = arrow.startX > trashX || arrow.endX > trashX;
      redraw();
      return;
    }
  }
});

canvas.addEventListener("mouseup", e => {
  if (mode === "edition") {
    if (draggingPoint) {
      if (hoverFusionTarget !== null) {
        // Fusion des points
        saveState();
        const idxToKeep = hoverFusionTarget;
        const idxToRemove = draggingPoint.pointIndex;

        // Remplace toutes occurrences idxToRemove par idxToKeep dans triangles
        triangles.forEach(tri => {
          for(let i=0; i<3; i++) {
            if(tri[i] === idxToRemove) tri[i] = idxToKeep;
          }
        });

        // Supprime le point idxToRemove
        points.splice(idxToRemove,1);

        // Ajuste indices dans triangles (car un point a disparu)
        triangles.forEach(tri => {
          for(let i=0; i<3; i++) {
            if(tri[i] > idxToRemove) tri[i]--;
          }
        });
      }

      draggingPoint = null;
      hoverFusionTarget = null;
      redraw();
      return;
    }
    if (draggingTriangle !== null) {
      // Suppression des points dans poubelle si déplacés
      saveState();
      const tri = triangles[draggingTriangle];
      const pointsToRemove = new Set();

      tri.forEach(pIndex => {
        if(pointInTrash(points[pIndex].x, points[pIndex].y)) {
          pointsToRemove.add(pIndex);
        }
      });

      if(pointsToRemove.size > 0) {
        // Supprime triangles qui utilisent ces points
        triangles = triangles.filter(tri => !tri.some(idx => pointsToRemove.has(idx)));

        // Supprime points (du plus grand indice au plus petit)
        const sortedIndices = Array.from(pointsToRemove).sort((a,b)=>b-a);
        sortedIndices.forEach(idx => {
          points.splice(idx,1);
          // Ajuste indices dans triangles
          triangles.forEach(tri => {
            for(let i=0; i<3; i++) {
              if(tri[i] > idx) tri[i]--;
            }
          });
        });
      }

      draggingTriangle = null;
      draggingTriangleOffset = null;
      redraw();
      return;
    }
  }

  if (mode === "simulation") {
    if (draggingArrowPoint) {
      draggingArrowPoint = null;
      redraw();
      return;
    }
    if (draggingArrow) {
      const arrow = draggingArrow.arrow;
      if(arrow.isOverTrash) {
        saveState();
        arrows = arrows.filter(a => a !== arrow);
      }
      draggingArrow = null;
      redraw();
      return;
    }
  }
});

// Fonction pour détecter si point est dans un triangle (utile pour drag triangle)
function pointInTriangle(p, tri) {
  const A = points[tri[0]];
  const B = points[tri[1]];
  const C = points[tri[2]];
  const areaOrig = triangleArea(A, B, C);
  const area1 = triangleArea(p, B, C);
  const area2 = triangleArea(A, p, C);
  const area3 = triangleArea(A, B, p);
  return Math.abs(areaOrig - (area1 + area2 + area3)) < 0.1;
}
function triangleArea(A, B, C) {
  return Math.abs((A.x*(B.y-C.y) + B.x*(C.y-A.y) + C.x*(A.y-B.y))/2);
}

redraw();
