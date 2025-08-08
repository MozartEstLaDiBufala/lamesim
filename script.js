const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');

let gridSize = 20;
let mode = 'lame'; // 'lame', 'force', 'erase'
let isMouseDown = false;
let forceNumb = 1000;

let forcePoints = [];
let lamePoints = [];

let maxTicks = 333;
let tick = 0;                  // Avance dans le temps

let simulationFramesTransitionForce = []; // 
let simulationFramesTransitionLame = []; // 
let simulationFramesForce = [[]]; // Liste des listes forcePoints dans le temps
let simulationFramesLame = [[]]; // Liste des listes lamePoints dans le temps


canvas.addEventListener('mousedown', () => isMouseDown = true);
canvas.addEventListener('mouseup', () => isMouseDown = false);
canvas.addEventListener('mouseleave', () => isMouseDown = false);
canvas.addEventListener('mousemove', drawPoint);
canvas.addEventListener('click', drawPoint);
const slider = document.getElementById("tickSlider");

let forceDirection = "right";  // Direction choisie par l'utilisateur
let pixelForceHasCollided = false;       // Devient true dès qu’on touche la lame


let decay = 0.8;       // facteur de décroissance à chaque diffusion
let queue = [];        // file pour BFS diffusion


// === Fonctions utilitaires pour gérer les points dans un tableau d'objets ===
function pointExists(points, x, y) {
  return points.some(p => p.x === x && p.y === y);
}

function applyBrush(x, y, callback) {
  const radius = Math.floor(brushSize / 2);
  for (let dx = -radius; dx <= radius; dx++) {
    for (let dy = -radius; dy <= radius; dy++) {
      const px = x + dx;
      const py = y + dy;
      callback(px, py);
    }
  }
}

function addPoint(points, x, y, force) {
  applyBrush(x, y, (px, py) => {
    if (!pointExists(points, px, py)) {
      points.push({ x: px, y: py, force });
    }
  });
}

function removePoint(points, x, y) {
  applyBrush(x, y, (px, py) => {
    const index = points.findIndex(p => p.x === px && p.y === py);
    if (index !== -1) {
      points.splice(index, 1);
    }
  });
}

function drawPoint(e) {
  const Newton = forceNumb; // a modifier selon les newton choisit

  if (!isMouseDown && e.type === 'mousemove') return;

  const rect = canvas.getBoundingClientRect();
  const x = Math.floor((e.clientX - rect.left) / gridSize);
  const y = Math.floor((e.clientY - rect.top) / gridSize);

  if (mode === 'lame') {
    addPoint(lamePoints, x, y,0);
    removePoint(forcePoints, x, y);
  } else if (mode === 'force') {
    addPoint(forcePoints, x, y,Newton);
    removePoint(lamePoints, x, y);
  } else if (mode === 'erase') {
    removePoint(lamePoints, x, y);
    removePoint(forcePoints, x, y);
  }

  generateDiffusionFrames(forcePoints, lamePoints);
  redraw();
}

slider.addEventListener("input", () => {
  tick = parseInt(slider.value);
});

let brushSize = 1;

function changeBrushSize(value) {
  brushSize = parseInt(value);
}

//-------------------------------------------------//

// -- Fonctions pour affichage -- //
function onTickChange(value) {
  tick = parseInt(value);
  document.getElementById("tickLabel").textContent = value;
  redraw();
}

function resizeCanvas() {
  canvas.width = window.innerWidth*0.9;
  canvas.height = window.innerHeight*0.92;
  redraw();
}

function redraw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawGrid();

  // On affiche les points de lame du tick courant avec couleur selon force
  if (simulationFramesLame[tick]) {
    for (const p of simulationFramesLame[tick]) {
      // Calcule l’intensité selon la force (par exemple force max = 10)
      const maxForce = 1000;
      let intensity = Math.min(p.force || 0, maxForce) / maxForce; // entre 0 et 1

      // Calcule une couleur bleu avec alpha selon intensité
      const alpha = 0.2 + 0.8 * intensity; // minimum 0.2 pour visibilité
      const color = `rgba(0,0,255,${alpha})`;

      drawCell(p.x, p.y, color);
    }
  }

  // Affiche les points de force comme avant
  if (simulationFramesForce[tick]) {
    for (const p of simulationFramesForce[tick]) {
      drawCell(p.x, p.y, 'red');
      drawForceArrow(p.x, p.y, forceDirection);
    }
  }
}

function drawCell(x, y, color) {
  ctx.fillStyle = color;
  ctx.fillRect(x * gridSize + 1, y * gridSize + 1, gridSize - 2, gridSize - 2);
}

function drawGrid() {
  ctx.strokeStyle = '#ccc';
  for (let x = 0; x <= canvas.width; x += gridSize) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, canvas.height);
    ctx.stroke();
  }
  for (let y = 0; y <= canvas.height; y += gridSize) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(canvas.width, y);
    ctx.stroke();
  }
}

function drawForceArrow(x, y, dir) {
  if (!dir) return;

  const cx = x * gridSize + gridSize / 2;
  const cy = y * gridSize + gridSize / 2;
  const len = gridSize / 2;

  let dx = 0, dy = 0;
  switch (dir) {
    case 'up': dy = -1; break;
    case 'down': dy = 1; break;
    case 'left': dx = -1; break;
    case 'right': dx = 1; break;
    case 'up-left': dx = -1; dy = -1; break;
    case 'up-right': dx = 1; dy = -1; break;
    case 'down-left': dx = -1; dy = 1; break;
    case 'down-right': dx = 1; dy = 1; break;
  }

  const angle = Math.atan2(dy, dx);
  const x2 = cx + Math.cos(angle) * len;
  const y2 = cy + Math.sin(angle) * len;

  // Corps de la flèche
  ctx.strokeStyle = 'black';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(x2, y2);
  ctx.stroke();

  // Pointe de flèche
  const arrowLength = 10;
  const arrowAngle = Math.PI / 6;

  ctx.beginPath();
  ctx.moveTo(x2, y2);
  ctx.lineTo(
    x2 - arrowLength * Math.cos(angle - arrowAngle),
    y2 - arrowLength * Math.sin(angle - arrowAngle)
  );
  ctx.lineTo(
    x2 - arrowLength * Math.cos(angle + arrowAngle),
    y2 - arrowLength * Math.sin(angle + arrowAngle)
  );
  ctx.lineTo(x2, y2);
  ctx.fillStyle = 'black';
  ctx.fill();
}

//------------------------------------------------//
function setMode(newMode) {
  mode = newMode;
  document.querySelectorAll('.controls button').forEach(btn => btn.classList.remove('active'));
  event.target.classList.add('active');
}

function changeGridSize(newSize) {
  gridSize = parseInt(newSize);
  redraw();
}

function setDirection(dir) {
  forceDirection = dir;
  document.querySelectorAll('.controls button').forEach(btn => btn.classList.remove('active'));
  event.target.classList.add('active');
  generateDiffusionFrames(forcePoints, lamePoints);
  redraw();
}

function changeForceNumb(newSize) {
  forceNumb = parseInt(newSize);
  redraw();
}

function generateDiffusionFrames(forcePoints, lamePoints, maxTicks = 333) {
  // === 1. Initialisation ===

  const framesLame = [];
  const framesForce = [];

  // On fait une copie profonde des tableaux d'entrée
  let currentForcePoints = forcePoints.map(p => ({ ...p }));
  let currentLamePoints = lamePoints.map(p => ({ ...p}));

  // on ajoute le premier tick en amont
  framesLame.push(currentLamePoints.map(p => ({ x: p.x, y: p.y, force: p.force })));
  framesForce.push(currentForcePoints.map(p => ({ x: p.x, y: p.y, angle: p.angle, force: p.force })));

  // On crée une map pour retrouver vite les points de lame par coordonnées
  const lameMap = new Map();
  for (const p of currentLamePoints) {
    lameMap.set(`${p.x},${p.y}`, p);
  }

  // Liste des points de lame à diffuser (coordonnée → force > 0)
  let activeLamePoints = [];

  // 3. Vecteur de direction selon forceDirection
  const dirMap = {
    'up':         { x: 0, y: -1 },
    'down':       { x: 0, y: 1 },
    'left':       { x: -1, y: 0 },
    'right':      { x: 1, y: 0 },
    'up-left':    { x: -1, y: -1 },
    'up-right':   { x: 1, y: -1 },
    'down-left':  { x: -1, y: 1 },
    'down-right': { x: 1, y: 1 }
  };
  const dirVec = dirMap[forceDirection];

  // === 2. Simulation par tick ===
  for (let tick = 0; tick < maxTicks; tick++) {
    // === a) MOUVEMENT des forces ===
    const nextForcePoints = [];

    for (const p of currentForcePoints) {
      // On calcule la prochaine position selon l’angle
      const nx = p.x + dirVec.x;
      const ny = p.y + dirVec.y;
      const key = `${nx},${ny}`;

      if (lameMap.has(key)) {
        // Collision avec la lame → la force passe dans la lame
        const lamePoint = lameMap.get(key);
        
        lamePoint.force += p.force; // accumulation
        
        activeLamePoints.push(lamePoint);
      } else {
        // Pas de collision → le point continue
        nextForcePoints.push({ ...p, x: nx, y: ny });
      }
    }
    
    currentForcePoints = nextForcePoints;
    
    // === b) DIFFUSION dans la lame ===
    const nextActiveLamePoints = [];
    const visited = new Set();

    const forceAdditions = new Map(); // clé = "x,y", valeur = force à ajouter

    for (const p of activeLamePoints) {
      //on perd 10% a chaqe tick
      const retained = p.force * 0.3 * 0.999;
      const toSpread = p.force * 0.7 * 0.999;

      p.force = retained;

      const neighbors = [
        [-1, -1], [0, -1], [1, -1],
        [-1,  0],          [1,  0],
        [-1,  1], [0,  1], [1,  1],
      ];

      // 1. Filtrer les voisins existants
      const validNeighbors = neighbors
        .map(([dx, dy]) => {
          const nx = p.x + dx;
          const ny = p.y + dy;
          const key = `${nx},${ny}`;
          return lameMap.has(key) ? { key, point: lameMap.get(key) } : null;
        })
        .filter(n => n !== null);

      if (validNeighbors.length === 0) continue;

      const spread = toSpread / validNeighbors.length;

      // 2. Ajouter la force équitablement aux voisins existants
      for (const { key, point } of validNeighbors) {
        const prev = forceAdditions.get(key) || 0;
        forceAdditions.set(key, prev + spread);
      }
    }

    // === Étape 2 : appliquer les contributions
    for (const [key, addedForce] of forceAdditions.entries()) {
      const point = lameMap.get(key);
      point.force += addedForce;

      if (!visited.has(key) && addedForce > 0.01) {
        nextActiveLamePoints.push(point);
        visited.add(key);
      }
    }



    activeLamePoints = nextActiveLamePoints;

    // === c) Sauvegarde de l’état actuel ===
    framesLame.push(currentLamePoints.map(p => ({ x: p.x, y: p.y, force: p.force })));
    framesForce.push(currentForcePoints.map(p => ({ x: p.x, y: p.y, angle: p.angle, force: p.force })));

    // === d) Fin si plus rien à simuler ===
    if (currentForcePoints.length === 0 && activeLamePoints.length === 0) {
      break;
    }
  }

  // === 3. Sauvegarde dans variables globales ===
  simulationFramesLame = framesLame;
  simulationFramesForce = framesForce;

  //console.log("a",framesLame)
}







// --- Initialisation ---

window.addEventListener('resize', resizeCanvas);
resizeCanvas();

//lamePoints[{x,y},{x,y}]
//En physique des matériaux, on parle de :
// Contraintes (stress) : la force interne par unité de surface (N/m²).
// Déformations (strain) : le changement de forme/distance entre les atomes.
// Les deux sont liées par la loi de Hooke généralisée dans les solides.