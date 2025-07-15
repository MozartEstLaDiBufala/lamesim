const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");

let arrows = [];
let points = [];
let lines = [];
let forceShapes = [];

let draggingPointIndex = null;
let draggingArrow = null;
let draggingArrowPoint = null;
let draggingShape = null;

let mode = "simulation";
let subMode = null;
let mouseX = 0;
let mouseY = 0;

let tempLine = null;
let traceStartIndex = null;

let history = [];
let future = [];

// --- Nouveaux états pour survol en gomme ---
let hoverPointIndex = null;
let hoverLineIndex = null;
let hoverArrowIndex = null;
let hoverOnShape = false;

function saveState() {
  history.push({
    arrows: JSON.parse(JSON.stringify(arrows)),
    points: JSON.parse(JSON.stringify(points)),
    lines: JSON.parse(JSON.stringify(lines)),
    mode,
    subMode
  });
  if (history.length > 100) history.shift();
  future = [];
}

function undo() {
  if (history.length > 0) {
    future.push({
      arrows: JSON.parse(JSON.stringify(arrows)),
      points: JSON.parse(JSON.stringify(points)),
      lines: JSON.parse(JSON.stringify(lines)),
      mode,
      subMode
    });
    const prev = history.pop();

    arrows.length = 0;
    points.length = 0;
    lines.length = 0;

    prev.arrows.forEach(a => arrows.push(a));
    prev.points.forEach(p => points.push(p));
    prev.lines.forEach(l => lines.push(l));

    mode = prev.mode;
    subMode = prev.subMode;

    redraw();
  }
}

function redo() {
  if (future.length > 0) {
    history.push({
      arrows: JSON.parse(JSON.stringify(arrows)),
      points: JSON.parse(JSON.stringify(points)),
      lines: JSON.parse(JSON.stringify(lines)),
      mode,
      subMode
    });
    const next = future.pop();

    arrows.length = 0;
    points.length = 0;
    lines.length = 0;

    next.arrows.forEach(a => arrows.push(a));
    next.points.forEach(p => points.push(p));
    next.lines.forEach(l => lines.push(l));

    mode = next.mode;
    subMode = next.subMode;

    redraw();
  }
}

function resizeCanvas() {
  canvas.width = window.innerWidth * 0.9;
  canvas.height = window.innerHeight * 0.92;
  redraw();
}
window.addEventListener("resize", resizeCanvas);
resizeCanvas();

function drawFormes() {
  const adjacency = {};
  for (let i = 0; i < points.length; i++) adjacency[i] = [];
  for (let [a, b] of lines) {
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

  const drawnCycles = new Set();

  for (let i = 0; i < points.length; i++) {
    const cycle = findCycle(i);
    if (cycle) {
      const key = [...cycle].sort().join("-");
      if (drawnCycles.has(key)) continue;
      drawnCycles.add(key);

      // Dessiner polygone gris semi-transparent si survol en gomme
      ctx.beginPath();
      const first = points[cycle[0]];
      ctx.moveTo(first.x, first.y);
      for (let j = 1; j < cycle.length; j++) {
        const pt = points[cycle[j]];
        ctx.lineTo(pt.x, pt.y);
      }
      ctx.closePath();
      if (mode === "edition" && subMode === "gomme" && hoverOnShape) {
        ctx.fillStyle = "rgba(200,200,200,0.3)";
      } else {
        ctx.fillStyle = "#ccc";
      }
      ctx.fill();
    }
  }

  // Tracer les lignes avec opacité réduite si survol en gomme
  ctx.strokeStyle = "#999";
  for (let i = 0; i < lines.length; i++) {
    const [a, b] = lines[i];
    const p1 = points[a];
    const p2 = points[b];
    ctx.beginPath();
    ctx.moveTo(p1.x, p1.y);
    ctx.lineTo(p2.x, p2.y);
    if (mode === "edition" && subMode === "gomme" && i === hoverLineIndex) {
      ctx.strokeStyle = "rgba(153,153,153,0.3)";
    } else {
      ctx.strokeStyle = "#999";
    }
    ctx.stroke();
  }

  if (tempLine) {
    const p1 = points[tempLine.start];
    ctx.beginPath();
    ctx.moveTo(p1.x, p1.y);
    ctx.lineTo(mouseX, mouseY);
    ctx.strokeStyle = "black";
    ctx.setLineDash([5, 5]);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  if (mode === "edition") {
    points.forEach((p, i) => {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 8, 0, 2 * Math.PI);
      if (subMode === "gomme" && i === hoverPointIndex) {
        ctx.fillStyle = "rgba(0,0,255,0.3)";
      } else {
        ctx.fillStyle = subMode === "gomme" && p.toDelete ? "orange" : "blue";
      }
      ctx.fill();
    });

    if (subMode === "ajout") {
      ctx.beginPath();
      ctx.arc(mouseX, mouseY, 6, 0, 2 * Math.PI);
      ctx.fillStyle = "#add8e6";
      ctx.fill();
    }

    if (subMode === "trace") {
      ctx.beginPath();
      ctx.arc(mouseX, mouseY, 5, 0, 2 * Math.PI);
      ctx.fillStyle = "black";
      ctx.fill();
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
  if (mode === "edition" && subMode === "gomme" && index === hoverArrowIndex) {
    ctx.strokeStyle = "rgba(255,0,0,0.3)";
  }
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
      { label: "Ajouter Point", value: "ajout" },
      { label: "Tracer Lien", value: "trace" },
      { label: "Déplacer", value: "deplacement" },
      { label: "Gomme", value: "gomme" },
    ];

    modes.forEach((m, i) => {
      ctx.fillStyle = subMode === m.value ? "#17a2b8" : "#6c757d";
      ctx.fillRect(20, 60 + i * 40, 140, 30);
      ctx.fillStyle = "white";
      ctx.fillText(m.label, 30, 80 + i * 40);
    });

    ctx.fillStyle = "#28a745";
    ctx.fillRect(canvas.width * 0.7, 20, 110, 30);
    ctx.fillStyle = "white";
    ctx.fillText("Ajouter Flèche", canvas.width * 0.7 + 5, 40);
    const shapeX = canvas.width * 0.7;
    const baseY = 60;
    const shapeSize = 30;
    const spacing = 40;

    ["circle", "rectangle", "triangle"].forEach((type, i) => {
      ctx.fillStyle = "#28a745";
      ctx.beginPath();
      const x = shapeX + shapeSize / 2;
      const y = baseY + i * spacing + shapeSize / 2;

      if (type === "circle") {
        ctx.arc(x, y, 10, 0, 2 * Math.PI);
        ctx.fill();
      } else if (type === "rectangle") {
        ctx.fillRect(shapeX, baseY + i * spacing, shapeSize, shapeSize);
      } else if (type === "triangle") {
        ctx.beginPath();
        ctx.moveTo(x, y - 10);
        ctx.lineTo(x - 10, y + 10);
        ctx.lineTo(x + 10, y + 10);
        ctx.closePath();
        ctx.fill();
      }
    });

    ctx.fillStyle = "black";
    ctx.fillText(`(${arrows.length})`, canvas.width * 0.7 + 120, 40);
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
  drawFormes();
  arrows.forEach(drawArrow);
  drawButtons();
}

canvas.addEventListener("mousemove", (e) => {
  const rect = canvas.getBoundingClientRect();
  mouseX = e.clientX - rect.left;
  mouseY = e.clientY - rect.top;

  // Gestion du déplacement de la forme complète
  if (draggingShape) {
    if (typeof draggingShape === "object") {
      const dx = mouseX - draggingShape.prevX;
      const dy = mouseY - draggingShape.prevY;
      moveShape(dx, dy);
      draggingShape.prevX = mouseX;
      draggingShape.prevY = mouseY;
    } else if (draggingShape === true) {
      draggingShape = { prevX: mouseX, prevY: mouseY };
    }
    redraw();
    return;  // On arrête ici car priorité au drag forme
  }

  // Réinitialiser hover (pour gomme)
  hoverPointIndex = null;
  hoverLineIndex = null;
  hoverArrowIndex = null;
  hoverOnShape = false;

  if (mode === "edition") {
    if (subMode === "gomme") {
      // Survol point ?
      for (let i = 0; i < points.length; i++) {
        if (Math.hypot(mouseX - points[i].x, mouseY - points[i].y) < 10) {
          hoverPointIndex = i;
          break;
        }
      }
      // Survol ligne ?
      if (hoverPointIndex === null) {
        for (let i = 0; i < lines.length; i++) {
          const [a, b] = lines[i];
          const p1 = points[a];
          const p2 = points[b];
          if (pointLineDistance(mouseX, mouseY, p1.x, p1.y, p2.x, p2.y) < 8) {
            hoverLineIndex = i;
            break;
          }
        }
      }
      // Survol flèche ?
      if (hoverPointIndex === null && hoverLineIndex === null) {
        for (let i = 0; i < arrows.length; i++) {
          const arr = arrows[i];
          if (
            Math.hypot(mouseX - arr.startX, mouseY - arr.startY) < 10 ||
            Math.hypot(mouseX - arr.endX, mouseY - arr.endY) < 10
          ) {
            hoverArrowIndex = i;
            break;
          }
          // corps flèche
          if (pointLineDistance(mouseX, mouseY, arr.startX, arr.startY, arr.endX, arr.endY) < 10) {
            hoverArrowIndex = i;
            break;
          }
        }
      }
      // Survol forme grise ? (polygone)
      if (hoverPointIndex === null && hoverLineIndex === null && hoverArrowIndex === null) {
        const adjacency = {};
        for (let i = 0; i < points.length; i++) adjacency[i] = [];
        for (let [a, b] of lines) {
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
        for (let i = 0; i < points.length; i++) {
          const cycle = findCycle(i);
          if (cycle) {
            ctx.beginPath();
            const first = points[cycle[0]];
            ctx.moveTo(first.x, first.y);
            for (let j = 1; j < cycle.length; j++) {
              const pt = points[cycle[j]];
              ctx.lineTo(pt.x, pt.y);
            }
            ctx.closePath();
            if (ctx.isPointInPath(mouseX, mouseY)) {
              hoverOnShape = true;
              break;
            }
          }
        }
      }
    }
  }

  if (mode === "edition" && subMode === "deplacement") {
    if (draggingPointIndex !== null) {
      points[draggingPointIndex].x = mouseX;
      points[draggingPointIndex].y = mouseY;
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
  console.log("mousedown at", mx, my);

  // Undo
  const undoX = canvas.width / 2 - 60;
  const redoX = canvas.width / 2 + 10;

  if (mx >= undoX && mx <= undoX + 50 && my >= 20 && my <= 50) {
    console.log("Undo clicked");
    undo();
    return;
  }
  if (mx >= redoX && mx <= redoX + 50 && my >= 20 && my <= 50) {
    console.log("Redo clicked");
    redo();
    return;
  }

  if (mx >= 20 && mx <= 120 && my >= 20 && my <= 50) {
    mode = "edition";
    subMode = null;
    tempLine = null;
    traceStartIndex = null;
    redraw();
    return;
  }
  if (mx >= 130 && mx <= 240 && my >= 20 && my <= 50) {
    mode = "simulation";
    subMode = null;
    tempLine = null;
    traceStartIndex = null;
    redraw();
    return;
  }

  if (mode === "edition") {
    const buttonHeight = 30;
    const buttonSpacing = 40;
    const buttonStartY = 60;
    const modes = ["ajout", "trace", "deplacement", "gomme"];
    for (let i = 0; i < modes.length; i++) {
      if (mx >= 20 && mx <= 160 && my >= buttonStartY + i * buttonSpacing && my <= buttonStartY + i * buttonSpacing + buttonHeight) {
        subMode = modes[i];
        tempLine = null;
        traceStartIndex = null;
        redraw();
        return;
      }
    }

    if (mx >= canvas.width * 0.7 && mx <= canvas.width * 0.7 + 110 && my >= 20 && my <= 50) {
      const shapeX = canvas.width * 0.7;
      const shapeSize = 30;
      const baseY = 60;
      ["circle", "rectangle", "triangle"].forEach((type, i) => {
        const sy = baseY + i * 40;
        if (mx >= shapeX && mx <= shapeX + shapeSize && my >= sy && my <= sy + shapeSize) {
          saveState();
          forceShapes.push({ type, x: 200 + i * 40, y: 200, size: 30 });
          redraw();
          return;
        }
      });
      saveState();
      arrows.push({ startX: 1000, startY: 100, endX: 1020, endY: 130 });
      redraw();
      return;
    }

    if (subMode === "ajout") {
      saveState();
      points.push({ x: mx, y: my });
      redraw();
      return;
    }
    if (subMode === "trace") {
      // Recherche point proche
      let closePointIndex = null;
      for (let i = 0; i < points.length; i++) {
        if (Math.hypot(points[i].x - mx, points[i].y - my) < 15) {
          closePointIndex = i;
          break;
        }
      }
      if (closePointIndex !== null) {
        if (traceStartIndex === null) {
          traceStartIndex = closePointIndex;
          tempLine = { start: closePointIndex };
          redraw();
          return;
        } else if (traceStartIndex !== closePointIndex) {
          saveState();
          lines.push([traceStartIndex, closePointIndex]);
          tempLine = null;
          traceStartIndex = null;
          redraw();
          return;
        }
      }
    }

    if (subMode === "deplacement") {
      // Détecter point proche
      for (let i = 0; i < points.length; i++) {
        if (Math.hypot(points[i].x - mx, points[i].y - my) < 10) {
          draggingPointIndex = i;
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
      // Déplacer forme complète
      draggingShape = true;
      saveState();
      return;
    }

    if (subMode === "gomme") {
      // Supprimer point survolé
      for (let i = 0; i < points.length; i++) {
        if (Math.hypot(points[i].x - mx, points[i].y - my) < 10) {
          saveState();
          points.splice(i, 1);
          // Supprimer lignes liées
          lines = lines.filter(l => l[0] !== i && l[1] !== i);
          // Recalibrer indices des lignes
          lines = lines.map(([a, b]) => [
            a > i ? a - 1 : a,
            b > i ? b - 1 : b
          ]);
          redraw();
          return;
        }
      }
      // Supprimer ligne survolée
      for (let i = 0; i < lines.length; i++) {
        const [a, b] = lines[i];
        const p1 = points[a];
        const p2 = points[b];
        if (pointLineDistance(mx, my, p1.x, p1.y, p2.x, p2.y) < 8) {
          saveState();
          lines.splice(i, 1);
          redraw();
          return;
        }
      }
      // Supprimer flèche survolée
      for (let i = 0; i < arrows.length; i++) {
        const arr = arrows[i];
        if (
          Math.hypot(arr.startX - mx, arr.startY - my) < 10 ||
          Math.hypot(arr.endX - mx, arr.endY - my) < 10 ||
          pointLineDistance(mx, my, arr.startX, arr.startY, arr.endX, arr.endY) < 10
        ) {
          saveState();
          arrows.splice(i, 1);
          redraw();
          return;
        }
      }
    }
  }
});

canvas.addEventListener("mouseup", (e) => {
  draggingPointIndex = null;
  draggingArrow = null;
  draggingArrowPoint = null;
  draggingShape = null;

});

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

function moveShape(dx, dy) {
  points.forEach(p => {
    p.x += dx;
    p.y += dy;
  });
  arrows.forEach(arr => {
    arr.startX += dx;
    arr.startY += dy;
    arr.endX += dx;
    arr.endY += dy;
  });
  redraw();
}

// Initial state save
saveState();
redraw();
