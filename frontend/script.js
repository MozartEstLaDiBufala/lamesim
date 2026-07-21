const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");

// --- Modèle de données ---
const blade = {
  contour: [],
  isClosed: false,
  mesh: { vertices: [], triangles: [] },
  physics: { centroid: { x: 0, y: 0 }, area: 0, mass: 1.0 },
  kinematics: { velocity: null }
};

const appState = {
  mode: "draw",
  showMesh: true,
  draggingVelocity: false
};

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
function generateMesh() {
  if (blade.contour.length < 3) return;

  // 1. Préparation des coordonnées pour Earcut
  const flatCoords = [];
  blade.contour.forEach(p => {
    flatCoords.push(p.x, p.y);
  });

  // 2. Génération du maillage
  const trianglesIndices = earcut(flatCoords);
  blade.mesh.vertices = [...blade.contour];
  blade.mesh.triangles = [];
  
  for (let i = 0; i < trianglesIndices.length; i += 3) {
    blade.mesh.triangles.push([
      trianglesIndices[i],
      trianglesIndices[i+1],
      trianglesIndices[i+2]
    ]);
  }

  // 3. Calculs physiques automatiques post-maillage
  const centroidData = calculateCentroid(blade.contour);
  blade.physics.centroid = { x: centroidData.x, y: centroidData.y };
  blade.physics.area = centroidData.area;

  // 4. Initialisation du vecteur vitesse au centre de gravité
  blade.kinematics.velocity = {
    startX: blade.physics.centroid.x,
    startY: blade.physics.centroid.y,
    endX: blade.physics.centroid.x,
    endY: blade.physics.centroid.y + 100 // Vecteur arbitraire pointant vers le bas
  };

  redraw();
}

// --- Événements Souris ---
canvas.addEventListener("mousedown", e => {
  const rect = canvas.getBoundingClientRect();
  const mx = e.clientX - rect.left;
  const my = e.clientY - rect.top;

  if (appState.mode === "draw" && !blade.isClosed) {
    if (blade.contour.length > 2 && distance(mx, my, blade.contour[0].x, blade.contour[0].y) < 15) {
      blade.isClosed = true;
      generateMesh();
    } else {
      blade.contour.push({ x: mx, y: my });
      redraw();
    }
  }
});

// --- Événements Interface (Boutons) ---
document.getElementById("btn-draw")?.addEventListener("click", () => { appState.mode = "draw"; redraw(); });
document.getElementById("btn-toggle-mesh")?.addEventListener("click", () => {
  appState.showMesh = !appState.showMesh;
  redraw();
});
document.getElementById("btn-mesh")?.addEventListener("click", () => {
  if (blade.contour.length < 3) {
    alert("Placez au moins 3 points pour former une géométrie valide.");
    return;
  }
  blade.isClosed = true;
  generateMesh();
});

document.getElementById("btn-calc-mass")?.addEventListener("click", () => {
  if (blade.physics.area === 0) {
    alert("Veuillez d'abord tracer et mailler la géométrie de la lame.");
    return;
  }
  const RHO_STEEL = 7850;
  const PIXEL_TO_METER = 0.001;
  const THICKNESS_M = 0.005;
  const areaSqMeters = blade.physics.area * Math.pow(PIXEL_TO_METER, 2);
  blade.physics.mass = RHO_STEEL * areaSqMeters * THICKNESS_M;
  
  const massInput = document.getElementById("input-mass");
  if (massInput) massInput.value = blade.physics.mass.toFixed(2);
});

// --- Moteur de Rendu Visuel ---
function redraw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // 1. Dessin du périmètre
  if (blade.contour.length > 0) {
    ctx.strokeStyle = "#333";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(blade.contour[0].x, blade.contour[0].y);
    for (let i = 1; i < blade.contour.length; i++) {
      ctx.lineTo(blade.contour[i].x, blade.contour[i].y);
    }
    if (blade.isClosed) ctx.closePath();
    ctx.stroke();
    
    ctx.fillStyle = "blue";
    blade.contour.forEach(p => {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  // 2. Dessin du maillage
  if (appState.showMesh && blade.isClosed && blade.mesh.triangles.length > 0) {
    blade.mesh.triangles.forEach(tri => {
      ctx.fillStyle = "rgba(150, 150, 150, 0.5)";
      ctx.strokeStyle = "#999";
      ctx.lineWidth = 1;
      
      ctx.beginPath();
      ctx.moveTo(blade.mesh.vertices[tri[0]].x, blade.mesh.vertices[tri[0]].y);
      ctx.lineTo(blade.mesh.vertices[tri[1]].x, blade.mesh.vertices[tri[1]].y);
      ctx.lineTo(blade.mesh.vertices[tri[2]].x, blade.mesh.vertices[tri[2]].y);
      ctx.closePath();
      
      ctx.fill();
      ctx.stroke();
    });
  }

  // 3. Dessin du vecteur de vitesse cinématique
  if (blade.isClosed && blade.kinematics.velocity) {
    const v = blade.kinematics.velocity;
    ctx.strokeStyle = "red";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(v.startX, v.startY);
    ctx.lineTo(v.endX, v.endY);
    ctx.stroke();

    // Pointe de la flèche
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

function updateDataPanel() {
  const dataContent = document.getElementById("data-content");
  if (!dataContent) return;
  
  if (blade.contour.length === 0) {
    dataContent.innerHTML = "<p>Aucun point tracé.</p>";
    return;
  }

  let html = `
    <p><strong>Statut:</strong> ${blade.isClosed ? "Géométrie fermée" : "En cours de tracé"}</p>
    <p><strong>Triangles:</strong> ${blade.mesh.triangles.length}</p>
    <table>
      <thead>
        <tr><th>Nœud</th><th>X (px)</th><th>Y (px)</th></tr>
      </thead>
      <tbody>
  `;

  blade.contour.forEach((p, index) => {
    html += `<tr><td>n°${index}</td><td>${Math.round(p.x)}</td><td>${Math.round(p.y)}</td></tr>`;
  });

  html += `</tbody></table>`;
  dataContent.innerHTML = html;
}