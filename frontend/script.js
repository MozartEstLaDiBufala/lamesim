const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");

// --- Modèle de données factorisé ---
const blade = {
  type: "blade",
  contour: [],
  isClosed: false,
  mesh: { vertices: [], triangles: [] },
  physics: { centroid: { x: 0, y: 0 }, area: 0, mass: 1.0 },
  kinematics: { velocity: null }
};

const obstacle = {
  type: "obstacle",
  contour: [],
  isClosed: false,
  mesh: { vertices: [], triangles: [] },
  physics: { centroid: { x: 0, y: 0 }, area: 0, mass: 0 }
};

const appState = {
  mode: "draw_blade", // "draw_blade", "draw_obstacle", "simulation"
  showMeshLines: true,
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

// --- Événements Souris (Interaction Canvas) ---
canvas.addEventListener("mousedown", e => {
  const rect = canvas.getBoundingClientRect();
  const mx = e.clientX - rect.left;
  const my = e.clientY - rect.top;

  if (blade.isClosed && blade.kinematics.velocity) {
    const v = blade.kinematics.velocity;
    if (distance(mx, my, v.endX, v.endY) < 15) {
      appState.draggingVelocity = true;
      return; 
    }
  }

  // Aiguillage du tracé selon le mode actif
  if (appState.mode === "draw_blade" || appState.mode === "draw_obstacle") {
    const target = appState.mode === "draw_blade" ? blade : obstacle;
    
    if (!target.isClosed) {
      if (target.contour.length > 2 && distance(mx, my, target.contour[0].x, target.contour[0].y) < 15) {
        target.isClosed = true;
        generateMesh(target); // Maillage automatique à la fermeture
      } else {
        target.contour.push({ x: mx, y: my });
        redraw();
      }
    }
  }
});

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
// --- Événements Interface (Boutons) ---
document.getElementById("btn-draw-blade")?.addEventListener("click", () => { appState.mode = "draw_blade"; });
document.getElementById("btn-draw-obs")?.addEventListener("click", () => { appState.mode = "draw_obstacle"; });
document.getElementById("btn-toggle-mesh")?.addEventListener("click", () => {
  appState.showMeshLines = !appState.showMeshLines;
  redraw();
});
document.getElementById("btn-sim")?.addEventListener("click", () => { appState.mode = "simulation"; });


// document.getElementById("btn-calc-mass")?.addEventListener("click", () => {
//   if (blade.physics.area === 0) {
//     alert("Veuillez d'abord tracer et mailler la géométrie de la lame.");
//     return;
//   }
//   const RHO_STEEL = 7850;
//   const PIXEL_TO_METER = 0.001;
//   const THICKNESS_M = 0.005;
//   const areaSqMeters = blade.physics.area * Math.pow(PIXEL_TO_METER, 2);
//   blade.physics.mass = RHO_STEEL * areaSqMeters * THICKNESS_M;
  
//   const massInput = document.getElementById("input-mass");
//   if (massInput) massInput.value = blade.physics.mass.toFixed(2);
// });

// --- Moteur de Rendu Visuel ---
// --- Moteur de Rendu Visuel ---
function drawEntity(target) {
  // 1. Dessin du périmètre
  if (target.contour.length > 0) {
    ctx.strokeStyle = target.type === "blade" ? "#333" : "#004085";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(target.contour[0].x, target.contour[0].y);
    for (let i = 1; i < target.contour.length; i++) {
      ctx.lineTo(target.contour[i].x, target.contour[i].y);
    }
    if (target.isClosed) ctx.closePath();
    ctx.stroke();
    
    // Dissimulation des nœuds de contrôle une fois la géométrie fermée
    if (!target.isClosed) {
      ctx.fillStyle = target.type === "blade" ? "blue" : "darkcyan";
      target.contour.forEach(p => {
        ctx.beginPath();
        ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
        ctx.fill();
      });
    }
  }

  // 2. Dessin du maillage continu (Base pour la Heatmap)
  if (target.isClosed && target.mesh.triangles.length > 0) {
    target.mesh.triangles.forEach(tri => {
      // Tons chauds/neutres pour la lame, tons froids pour la bûche
      ctx.fillStyle = target.type === "blade" ? "rgba(180, 180, 180, 0.7)" : "rgba(173, 216, 230, 0.7)";
      
      ctx.beginPath();
      ctx.moveTo(target.mesh.vertices[tri[0]].x, target.mesh.vertices[tri[0]].y);
      ctx.lineTo(target.mesh.vertices[tri[1]].x, target.mesh.vertices[tri[1]].y);
      ctx.lineTo(target.mesh.vertices[tri[2]].x, target.mesh.vertices[tri[2]].y);
      ctx.closePath();
      
      ctx.fill(); // Le remplissage gris/bleu est permanent
      
      // Les traits géométriques sont conditionnels
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