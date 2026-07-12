const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');

let gridSize = 20;
let mode = 'lame'; // 'lame', 'force', 'erase'
let isMouseDown = false;
let forceNumb = 1000;
let forceNumbMax = 3*forceNumb;

let forcePoints = [];
let lamePoints = [];

let maxTicks = 333;
let tick = 0;                  // Avance dans le temps

const costPerTile = 300;    // N par carreau

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

//generateDiffusionFrames(forcePoints, lamePoints);  redraw();}

let forceDirection = "right";  // Direction choisie par l'utilisateur
let pixelForceHasCollided = false;       // Devient true dès qu’on touche la lame


let decay = 0.8;       // facteur de décroissance à chaque diffusion
let queue = [];        // file pour BFS diffusion

let dirVecfx = 1;
let dirVecfy = 0;

const baseRetention = 0.8;
const baseDissipation = 0.02;

// Force max pour laquelle on garde presque toute l'énergie
const forceRef = forceNumbMax; 

const bounceFactor = 0.3; // Intensité du rebond (0 = pas de rebond, 1 = rebond complet)
const isotropicFactor = 0.2; // Part de diffusion dans toutes les directions


const minDirBackFactor = 0.05; // fraction minimale pour l'arrière (si tu veux jamais 0)
const eps = 1e-9;


let retentionDynamic = 0;

// Dissipation augmente si la force est faible, baisse si elle est forte
let dissipationDynamic = 0;

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

function addPoint(points, x, y, force, fx, fy) {
  applyBrush(x, y, (px, py) => {
    if (!pointExists(points, px, py)) {
      points.push({ x: px, y: py, force:force, fx:fx, fy:fy});
    };
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
    addPoint(lamePoints, x, y,force=0,fx=0,fy=0);
    removePoint(forcePoints, x, y);
  } else if (mode === 'force') {
    addPoint(forcePoints, x, y,force=Newton,fx=1,fy=0);
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

let brushSize = 2;

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

function getForceColor(force, maxForce) {
  // Normaliser la force entre 0 et 1
  const ratio = Math.min(force / maxForce, 1);

  // Gris clair = rgb(200,200,200), rouge = rgb(255,0,0)
  const r = Math.round(200 + (255 - 200) * ratio); // 200 → 255
  const g = Math.round(200 * (1 - ratio));         // 200 → 0
  const b = Math.round(200 * (1 - ratio));         // 200 → 0

  return `rgb(${r},${g},${b})`;
}

function redraw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawGrid();

  // Points de la lame (diffusion)
  if (simulationFramesLame[tick]) {
  for (const p of simulationFramesLame[tick]) {
    // Intensité entre 0 et 1, max = 3*forceNumb
    const color = getForceColor(p.force,forceNumbMax);
    drawCell(p.x, p.y, color);
  }
}

  // Points de force (sources)
  if (simulationFramesForce[tick]) {
    for (const p of simulationFramesForce[tick]) {
      drawCell(p.x, p.y, 'red');
      drawForceArrow(p.x, p.y, dirVecfx, dirVecfy);
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

function drawForceArrow(x, y, fx, fy) {
  if (!fx && !fy) return;

  const cx = x * gridSize + gridSize / 2;
  const cy = y * gridSize + gridSize / 2;
  const len = gridSize / 2;

  const angle = Math.atan2(fy, fx);
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
  dirVecfx = dirMap[forceDirection].x;
  dirVecfy = dirMap[forceDirection].y;
  
  generateDiffusionFrames(forcePoints, lamePoints);
  redraw();
}

function changeForceNumb(newSize) {
  forceNumb = parseInt(newSize);
  forceNumbMax = 3*forceNumb;
  
  generateDiffusionFrames(forcePoints, lamePoints);
  updateForceGradientLabels(forceNumb);
  redraw();
}

function updateForceGradientLabels(forceMax) {
  document.getElementById("forceMax").textContent = forceMax + " N/m";
}

//------------------------------------------------//

function generateDiffusionFrames(forcePoints, lamePoints) {
  const framesLame = [];
  const framesForce = [];

  // Copie initiale des points avec les deplacement selon la direction
  let currentForcePoints = forcePoints.map(p => ({ ...p, fx: dirVecfx, fy:dirVecfy }));
  let currentLamePoints = lamePoints.map(p => ({ ...p }));

  framesLame.push(currentLamePoints.map(p => ({ ...p })));
  framesForce.push(currentForcePoints.map(p => ({ ...p })));

  // Map pour accès rapide aux points de lame
  const lameMap = new Map();
  for (const lp of currentLamePoints) {
    lameMap.set(`${lp.x},${lp.y}`, lp);
  }

  // Liste des points actifs dans la lame (ceux qui ont une force)
  let activeLamePoints = [];
  for (const lp of lameMap.values()) {
    if (lp.fx !== 0 || lp.fy !== 0) activeLamePoints.push(lp);
  }

  for (let tick = 0; tick <= maxTicks; tick++) {

    // --- a) Mouvement des forces avant collision ---
    const nextForcePoints = [];
    for (const p of currentForcePoints) {
      // Retention augmente avec la force, mais plafonnée à 0.95
      retentionDynamic = Math.min(baseRetention + 0.15 * (p.force / forceRef),0.95);

      // Dissipation augmente si la force est faible, baisse si elle est forte
      dissipationDynamic = baseDissipation + (costPerTile / 10000) * (1 - forceNumb / forceRef);

      const nx = p.x + p.fx;
      const ny = p.y + p.fy;
      const key = `${nx},${ny}`;

      if (lameMap.has(key)) {
        // Collision → injecte la force dans la lame
        const lp = lameMap.get(key);
        lp.fx += p.fx/retentionDynamic; //comme la retention s'applique directement, il faut ajouter la partie qui va etre supprimé par la suite
        lp.fy += p.fy/retentionDynamic;
        lp.force += forceNumb/retentionDynamic;
        if (!activeLamePoints.includes(lp)) activeLamePoints.push(lp);
      } else {
        // Pas de collision → force continue à avancer
        nextForcePoints.push({ ...p, x: nx, y: ny });
      }
    }
    currentForcePoints = nextForcePoints;

    // --- b) Diffusion dans la lame ---
    const newActiveLamePoints = [];
    
    const maxDistance = Math.floor(forceNumb / costPerTile);
    const neighborsDelta = [];

    for (let dx = -maxDistance; dx <= maxDistance; dx++) {
      for (let dy = -maxDistance; dy <= maxDistance; dy++) {
        // On saute (0,0) car c'est notre position
        if (dx === 0 && dy === 0) continue;

        // limiter au rayon circulaire :
        if (Math.sqrt(dx*dx + dy*dy) <= maxDistance) {
          neighborsDelta.push([dx, dy]);
        }
      }
    }

    for (const p of activeLamePoints) {
      // --- 1. Norme de la force vectorielle actuelle ---
      const norm = Math.hypot(p.fx, p.fy); // Longueur du vecteur force
      const dirX = norm === 0 ? 0 : p.fx / norm; // Direction X unitaire
      const dirY = norm === 0 ? 0 : p.fy / norm; // Direction Y unitaire

      // --- 2. Conserver une partie de la force ---

      const fxRetained = p.fx * retentionDynamic;
      const fyRetained = p.fy * retentionDynamic;
      const forceRetained = p.force * retentionDynamic;
      p.fx = fxRetained;
      p.fy = fyRetained;
      p.force = forceRetained;

      // --- 3. Force à partager avec dissipation ---
      const fxToShare = (p.fx * (1 - retentionDynamic)) - dissipationDynamic;
      const fyToShare = (p.fy * (1 - retentionDynamic)) - dissipationDynamic;
      const forceToShare = (p.force * (1 - retentionDynamic)) - dissipationDynamic;

      if (forceToShare <= 0) continue; // Si plus de force, on passe

      // --- 4. Calcul des poids vers les voisins (bucketisé + renormalisation bords) ---

      // On ne considère que l'anneau 8-voisins (diffusion locale par tick)
      const neighbors8 = [
        [ 1,  0], [-1,  0], [ 0,  1], [ 0, -1],
        [ 1,  1], [ 1, -1], [-1,  1], [-1, -1]
      ];

      // Seuils d’angle (cosθ)
      const frontThresh = 0.5;  // cosθ ≥ 0.5 → "avant"
      const sideThresh  = 0.25; // |cosθ| ≤ 0.25 → "latéral" (autour de 90°)

      // Parts “idéales” par bucket (somme = 1)
      const alphaFront = 0.75;
      const alphaSide  = 0.20;
      const alphaBack  = 0.05;

      // Pénalités
      const gammaDist     = 1;               // pénalité distance (1/d^γ) – ici 1 pour diagonales vs orthogonaux
      const diagPenalty   = 1 / Math.SQRT2;  // pénalité supplémentaire pour diagonales

      // On construit les 3 buckets en fonction de l’angle
      const buckets = { front: [], side: [], back: [] };

      for (const [dx, dy] of neighbors8) {
        const key = `${p.x + dx},${p.y + dy}`;
        if (!lameMap.has(key)) continue; // pas de voisin -> on saute

        const vlen = Math.hypot(dx, dy); // 1 pour ortho, ~1.414 pour diag
        // cosθ entre direction locale (dirX, dirY) et le vecteur vers le voisin (dx,dy)
        const cosTheta = (norm === 0) ? 0 : (dx * dirX + dy * dirY) / vlen;

        // Choix du bucket
        let bucketName;
        if (cosTheta >= frontThresh) {
          bucketName = 'front';
        } else if (Math.abs(cosTheta) <= sideThresh) {
          bucketName = 'side';
        } else if (cosTheta <= -frontThresh) {
          bucketName = 'back';
        } else {
          // Zone intermédiaire : s’il reste positif → plutôt front, sinon back
          bucketName = (cosTheta > 0) ? 'front' : 'back';
        }

        // Poids angulaire interne au bucket :
        // - avant : plus cosθ est grand, plus le poids est grand
        // - latéral : maximum autour de 90° → utiliser (1 - |cosθ|)
        // - arrière : plus cosθ est négatif, plus le poids est grand → utiliser (-cosθ)
        let angleWeight;
        if (bucketName === 'front') {
          angleWeight = Math.max(0, cosTheta);        // 0..1
        } else if (bucketName === 'side') {
          angleWeight = Math.max(0, 1 - Math.abs(cosTheta)); // 0..1, pic à 90°
        } else {
          angleWeight = Math.max(0, -cosTheta);       // 0..1
        }

        // Pénalité distance (favorise ortho) + pénalité diagonale
        const distWeight = 1 / Math.pow(vlen, gammaDist);
        const extraDiag  = (dx !== 0 && dy !== 0) ? diagPenalty : 1;

        const w = angleWeight * distWeight * extraDiag; // poids interne du voisin dans son bucket

        if (w > 0) buckets[bucketName].push({ key, w });
      }

      // --- 5. Renormalisation des parts de buckets si bords/trous ---
      // Parts “réelles” au tick (peuvent être réallouées si bucket vide)
      let shareF = alphaFront, shareS = alphaSide, shareB = alphaBack;

      const hasF = buckets.front.length > 0;
      const hasS = buckets.side.length  > 0;
      const hasB = buckets.back.length  > 0;

      // Total à redistribuer (buckets vides)
      let missing = 0;
      if (!hasF) { missing += shareF; shareF = 0; }
      if (!hasS) { missing += shareS; shareS = 0; }
      if (!hasB) { missing += shareB; shareB = 0; }

      // Redistribuer “missing” proportionnellement aux alphas des buckets restants
      const alphaPresent = (hasF ? alphaFront : 0) + (hasS ? alphaSide : 0) + (hasB ? alphaBack : 0);
      if (missing > 0 && alphaPresent > 0) {
        if (hasF) shareF += missing * (alphaFront / alphaPresent);
        if (hasS) shareS += missing * (alphaSide  / alphaPresent);
        if (hasB) shareB += missing * (alphaBack  / alphaPresent);
      }

      // --- 6. Répartition à l’intérieur de chaque bucket (normalisation locale) ---
      function distributeBucket(share, list) {
        // share = fraction de la force à partager dédiée à ce bucket (ex: 0.75)
        // list = [{key, w}, ...]
        const sumW = list.reduce((s, n) => s + n.w, 0);
        if (share <= 0 || sumW <= 0) return [];
        // On renvoie des paires (key, fracBucket) où fracBucket ∈ [0,share]
        return list.map(n => ({ key: n.key, frac: (n.w / sumW) * share }));
      }

      const allFractions = [
        ...distributeBucket(shareF, buckets.front),
        ...distributeBucket(shareS, buckets.side),
        ...distributeBucket(shareB, buckets.back),
      ];

      // Si aucun voisin n’a reçu de fraction → on saute
      if (allFractions.length === 0) continue;

      // --- 7. Répartition proportionnelle de la force à partager ---
      // NB : on partage force “scalaire” ET composantes fx/fy dans la même proportion.
      //      (Option : propager la direction u=(dirX,dirY) plutôt que fx/fy si tu veux)
      for (const { key, frac } of allFractions) {
        const neighbor = lameMap.get(key);

        neighbor.fx    += fxToShare    * frac;
        neighbor.fy    += fyToShare    * frac;
        neighbor.force += forceToShare * frac;

        if (!newActiveLamePoints.includes(neighbor)) {
          newActiveLamePoints.push(neighbor);
        }
      }

    
    }
    activeLamePoints = newActiveLamePoints;
    // --- c) Sauvegarde des frames ---
    framesLame.push(currentLamePoints.map(p => ({ ...p })));
    framesForce.push(currentForcePoints.map(p => ({ ...p })));

    // fin si plus rien à simuler
    if (currentForcePoints.length === 0 && activeLamePoints.length === 0) break;
  }

  simulationFramesLame = framesLame;
  simulationFramesForce = framesForce;
  
  console.log('framesLame',framesLame);
  console.log('framesForce',framesForce);

  
};




// --- Initialisation ---

window.addEventListener('resize', resizeCanvas);
changeBrushSize(brushSize);
resizeCanvas();

//lamePoints[{x,y},{x,y}]
//En physique des matériaux, on parle de :
// Contraintes (stress) : la force interne par unité de surface (N/m²).
// Déformations (strain) : le changement de forme/distance entre les atomes.
// Les deux sont liées par la loi de Hooke généralisée dans les solides.
