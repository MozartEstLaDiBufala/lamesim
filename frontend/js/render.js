import { blade, obstacle, appState, materialsDB, simulationState } from './state.js';
import { isPointInRect } from './mathUtils.js';

export const canvas = document.getElementById("canvas");
export const ctx = canvas.getContext("2d");

function getStressColor(stress, maxStress, baseColor) {
  if (!maxStress || stress <= 0 || (stress / maxStress) < 0.1) return baseColor;
  const ratio = Math.min(1, Math.max(0, stress / maxStress));
  return `hsla(${(1 - ratio) * 60}, 100%, 50%, 0.85)`;
}

// Nouvelle fonction de subdivision adaptative et d'ombrage transparent
function drawThicknessOverlay(ctx, p1, p2, p3, minT, maxT, depth = 0) {
  const d12 = Math.hypot(p2.x - p1.x, p2.y - p1.y);
  const d23 = Math.hypot(p3.x - p2.x, p3.y - p2.y);
  const d31 = Math.hypot(p1.x - p3.x, p1.y - p3.y);
  const maxEdge = Math.max(d12, d23, d31);

  if (maxEdge < 15 || depth > 7) {
    const t_avg = (p1.t + p2.t + p3.t) / 3;
    const ratio = maxT === minT ? 0 : (t_avg - minT) / (maxT - minT);
    const alpha = ratio * 0.65;
    const shadowColor = `rgba(15, 25, 45, ${alpha})`;

    ctx.fillStyle = shadowColor;
    ctx.strokeStyle = shadowColor;
    ctx.lineWidth = 0.1;

    ctx.beginPath();
    ctx.moveTo(p1.x, p1.y);
    ctx.lineTo(p2.x, p2.y);
    ctx.lineTo(p3.x, p3.y);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    return;
  }

  const m12 = { x: (p1.x + p2.x)/2, y: (p1.y + p2.y)/2, t: (p1.t + p2.t)/2 };
  const m23 = { x: (p2.x + p3.x)/2, y: (p2.y + p3.y)/2, t: (p2.t + p3.t)/2 };
  const m31 = { x: (p3.x + p1.x)/2, y: (p3.y + p1.y)/2, t: (p3.t + p1.t)/2 };

  drawThicknessOverlay(ctx, p1, m12, m31, minT, maxT, depth + 1);
  drawThicknessOverlay(ctx, m12, p2, m23, minT, maxT, depth + 1);
  drawThicknessOverlay(ctx, m31, m23, p3, minT, maxT, depth + 1);
  drawThicknessOverlay(ctx, m12, m23, m31, minT, maxT, depth + 1);
}

function drawArrow(ctx, fromx, fromy, tox, toy, color = "red", width = 3) {
  const headlen = 12;
  const dx = tox - fromx;
  const dy = toy - fromy;
  const angle = Math.atan2(dy, dx);
  
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = width;
  
  ctx.beginPath();
  ctx.moveTo(fromx, fromy);
  ctx.lineTo(tox, toy);
  ctx.stroke();
  
  ctx.beginPath();
  ctx.moveTo(tox, toy);
  ctx.lineTo(tox - headlen * Math.cos(angle - Math.PI / 6), toy - headlen * Math.sin(angle - Math.PI / 6));
  ctx.lineTo(tox - headlen * Math.cos(angle + Math.PI / 6), toy - headlen * Math.sin(angle + Math.PI / 6));
  ctx.closePath();
  ctx.fill();
}

function drawEntity(target) {
  let contourToDraw = target.contour; 
  let meshVertices = target.mesh.vertices;
  let activeStresses = null;

  // 1. Données de simulation
  if (appState.mode === "simulation" && simulationState && simulationState.buffer.length > 0) {
    const frameData = simulationState.buffer[simulationState.currentIndex].data[target.type];
    if (frameData && frameData.vertices && frameData.vertices.length > 0) {
      contourToDraw = frameData.vertices;
      meshVertices = frameData.vertices;
      activeStresses = frameData.peak_stresses;
    }
  }

  // 2. DESSIN DU MAILLAGE (Placé en arrière-plan)
  if (target.isClosed && target.mesh && target.mesh.elements.length > 0) {
    let maxStress = activeStresses ? Math.max(...activeStresses) : 0;
    
    let minT = Infinity, maxT = -Infinity;
    meshVertices.forEach(v => {
      let t = v.t !== undefined ? v.t : 1.0;
      if (t < minT) minT = t;
      if (t > maxT) maxT = t;
    });

    target.mesh.elements.forEach((element, triIndex) => {
      let v0 = meshVertices[element.nodes[0]];
      let v1 = meshVertices[element.nodes[1]];
      let v2 = meshVertices[element.nodes[2]];
      
      if (!v0 || !v1 || !v2) return;

      if (v0.t === undefined) v0.t = 1.0;
      if (v1.t === undefined) v1.t = 1.0;
      if (v2.t === undefined) v2.t = 1.0;

      let baseColor = (typeof materialsDB !== 'undefined' && materialsDB[element.material]) ? materialsDB[element.material].color : "rgba(180, 180, 180, 0.7)";

      if (appState.mode === "simulation" && activeStresses && activeStresses[triIndex] !== undefined) {
        ctx.fillStyle = getStressColor(activeStresses[triIndex], maxStress, baseColor);
        ctx.beginPath();
        ctx.moveTo(v0.x, v0.y);
        ctx.lineTo(v1.x, v1.y);
        ctx.lineTo(v2.x, v2.y);
        ctx.closePath();
        ctx.fill(); 
      } else {
        ctx.fillStyle = baseColor;
        ctx.beginPath();
        ctx.moveTo(v0.x, v0.y);
        ctx.lineTo(v1.x, v1.y);
        ctx.lineTo(v2.x, v2.y);
        ctx.closePath();
        ctx.fill();

        drawThicknessOverlay(ctx, v0, v1, v2, minT, maxT);
      }
      
      if (appState.showMeshLines) {
        ctx.strokeStyle = target.type === "blade" ? "rgba(150, 150, 150, 0.5)" : "#87CEFA";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(v0.x, v0.y);
        ctx.lineTo(v1.x, v1.y);
        ctx.lineTo(v2.x, v2.y);
        ctx.closePath();
        ctx.stroke();
      }
    });
  }

  // 3. DESSIN DES CONTOURS (Par-dessus le maillage)
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

    if (target.internalEdges && target.internalEdges.length > 0) {
      ctx.strokeStyle = target.type === "blade" ? "#666" : "#004085";
      ctx.beginPath();
      target.internalEdges.forEach(edge => {
        ctx.moveTo(contourToDraw[edge.p1].x, contourToDraw[edge.p1].y);
        ctx.lineTo(contourToDraw[edge.p2].x, contourToDraw[edge.p2].y);
      });
      ctx.stroke();
    }
  }

  // 4. DESSIN DES POINTS NŒUDS (Toujours visibles en mode édition)
  if (appState.mode !== "simulation" && contourToDraw.length > 0) {
    ctx.fillStyle = target.type === "blade" ? "blue" : "darkcyan";
    contourToDraw.forEach(p => {
      ctx.beginPath(); 
      ctx.arc(p.x, p.y, 4, 0, Math.PI * 2); 
      ctx.fill();
    });
  }

  // 5. DESSIN DES FIXATIONS
  if (target.type === "blade" && target.fixations && target.fixations.length > 0) {
    target.fixations.forEach(rect => {
      ctx.fillStyle = "rgba(0, 255, 0, 0.2)"; 
      ctx.strokeStyle = "rgba(0, 200, 0, 0.5)";
      ctx.fillRect(rect.x, rect.y, rect.w, rect.h); 
      ctx.strokeRect(rect.x, rect.y, rect.w, rect.h);
    });
    
    ctx.fillStyle = "lime";
    meshVertices.forEach(v => {
      if (target.fixations.some(rect => isPointInRect(v.x, v.y, rect))) {
        ctx.beginPath(); 
        ctx.arc(v.x, v.y, 4, 0, Math.PI * 2); 
        ctx.fill(); 
        ctx.stroke();
      }
    });
  }

  // 6. DESSIN DE LA CINÉMATIQUE (Flèche de vitesse intégrée ici)
  if (target.kinematics && target.kinematics.velocity && appState.mode !== "simulation") {
    const vel = target.kinematics.velocity;
    if (vel.startX !== undefined && vel.endX !== undefined) {
      drawArrow(ctx, vel.startX, vel.startY, vel.endX, vel.endY, "red", 3);
    }
  }
}

// --- Génération de l'interface des données ---

// Mémoire d'état pour éviter les reconstructions HTML inutiles
let previousBladeCount = -1;
let previousObstacleCount = -1;

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
      
      <table style="width: 100%; border-collapse: collapse; font-size: 13px; text-align: center;">
        <thead>
          <tr style="background-color: #e9ecef; border-bottom: 2px solid #ccc;">
            <th style="padding: 4px; border: 1px solid #ccc;">Nœud</th>
            <th style="padding: 4px; border: 1px solid #ccc;">X (px)</th>
            <th style="padding: 4px; border: 1px solid #ccc;">Y (px)</th>
            <th style="padding: 4px; border: 1px solid #ccc;">Ép. (cm)</th>
          </tr>
        </thead>
        <tbody>
  `;

  entity.contour.forEach((p, index) => {
    let t = p.t !== undefined ? p.t : 1.0;
    
    // Ajout des attributs "data-*" pour identifier facilement la cible lors de l'édition
    html += `
          <tr>
            <td style="padding: 4px; border: 1px solid #eee;">n°${index}</td>
            <td style="padding: 4px; border: 1px solid #eee;">
              <input type="number" step="0.1" class="coord-input" data-entity="${entity.type}" data-index="${index}" data-coord="x" value="${p.x.toFixed(1)}" style="width: 60px; text-align: center; border: 1px solid #ccc; border-radius: 3px;">
            </td>
            <td style="padding: 4px; border: 1px solid #eee;">
              <input type="number" step="0.1" class="coord-input" data-entity="${entity.type}" data-index="${index}" data-coord="y" value="${p.y.toFixed(1)}" style="width: 60px; text-align: center; border: 1px solid #ccc; border-radius: 3px;">
            </td>
            <td style="padding: 4px; border: 1px solid #eee;">
              <input type="number" step="0.1" class="coord-input" data-entity="${entity.type}" data-index="${index}" data-coord="t" value="${t.toFixed(1)}" style="width: 60px; text-align: center; border: 1px solid #ccc; border-radius: 3px;">
            </td>
          </tr>`;
  });

  html += `</tbody></table></div>`;
  return html;
}

export function updateDataPanel() {
  const dataContent = document.getElementById("data-content");
  if (!dataContent) return;

  // Si la structure (nombre de points) a changé, on recompile tout le HTML
  if (blade.contour.length !== previousBladeCount || obstacle.contour.length !== previousObstacleCount) {
    let finalHtml = generateEntityTable(blade, "Données de la Lame");
    finalHtml += `<hr style="border: 0; border-top: 1px solid #ccc; margin: 15px 0;">`;
    finalHtml += generateEntityTable(obstacle, "Données de la Bûche");
    
    dataContent.innerHTML = finalHtml;
    
    previousBladeCount = blade.contour.length;
    previousObstacleCount = obstacle.contour.length;
  } 
  // Si la structure est identique, on se contente de mettre à jour les valeurs (Patching)
  else {
    const inputs = dataContent.querySelectorAll('.coord-input');
    inputs.forEach(input => {
      // Protection anti-saisie : on ne met pas à jour le champ si l'utilisateur est en train de taper dedans
      if (document.activeElement === input) return;

      const entityType = input.getAttribute('data-entity');
      const idx = parseInt(input.getAttribute('data-index'));
      const coord = input.getAttribute('data-coord');
      
      const target = entityType === 'blade' ? blade : obstacle;
      
      if (target.contour[idx]) {
        let val = target.contour[idx][coord];
        if (val === undefined && coord === 't') val = 1.0; // Valeur par défaut pour l'épaisseur
        if (val !== undefined) input.value = val.toFixed(1);
      }
    });
  }
}

export function redraw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  
  drawEntity(blade);
  drawEntity(obstacle);

  // Indications de l'outil segment de séparation
  if (appState.mode === "add_segment" && appState.segmentStart) {
    ctx.fillStyle = "orange";
    ctx.beginPath(); 
    ctx.arc(appState.segmentStart.point.x, appState.segmentStart.point.y, 6, 0, Math.PI * 2); 
    ctx.fill();
  }
  
  updateDataPanel();
}