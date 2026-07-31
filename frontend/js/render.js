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
  // 3.bis DESSIN DES MESURES (Si activé)
  if (appState.showMeasurements && contourToDraw.length > 1 && appState.mode !== "simulation") {
    ctx.font = "bold 11px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    for (let i = 0; i < contourToDraw.length; i++) {
      // Si la forme n'est pas fermée, on ne relie pas le dernier point au premier
      if (i === contourToDraw.length - 1 && !target.isClosed) break;

      const p1 = contourToDraw[i];
      const p2 = contourToDraw[(i + 1) % contourToDraw.length];

      const dx = p2.x - p1.x;
      const dy = p2.y - p1.y;
      
      // Distance mathématique : Math.hypot calcule la norme du vecteur. 
      // 1 pixel = 1 mm, donc on a directement des millimètres.
      const distMm = Math.hypot(dx, dy); 
      
      // Positionnement au milieu du segment
      const midX = p1.x + dx / 2;
      const midY = p1.y + dy / 2;

      // Décalage perpendiculaire pour ne pas écrire SUR la ligne (12 pixels de décalage)
      const angle = Math.atan2(dy, dx);
      const offsetX = Math.cos(angle - Math.PI / 2) * 12;
      const offsetY = Math.sin(angle - Math.PI / 2) * 12;

      const text = `${distMm.toFixed(1)} mm`;
      
      // Fond blanc semi-transparent pour garantir la lisibilité
      const textWidth = ctx.measureText(text).width;
      ctx.fillStyle = "rgba(255, 255, 255, 0.8)";
      ctx.fillRect(midX + offsetX - textWidth / 2 - 3, midY + offsetY - 7, textWidth + 6, 14);

      // Texte en rouge foncé
      ctx.fillStyle = "#b71c1c";
      ctx.fillText(text, midX + offsetX, midY + offsetY);
    }
  }

  // 4. DESSIN DES POINTS NŒUDS (Toujours visibles en mode édition)
  if (appState.mode !== "simulation" && contourToDraw.length > 0 && appState.showPointMeshLines) {
    ctx.fillStyle = target.type === "blade" ? "blue" : "darkcyan";
    contourToDraw.forEach(p => {
      ctx.beginPath(); 
      ctx.arc(p.x, p.y, 4, 0, Math.PI * 2); 
      ctx.fill();
    });
  }

  // 5. DESSIN DES FIXATIONS
  if (target.fixations && target.fixations.length > 0) {
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

function drawScaleRuler() {
  const rulerLengthPx = 100; // 100 pixels = 10 cm
  const label = "10 cm";
  
  const x = 20;
  const y = canvas.height - 20;

  ctx.strokeStyle = "#333";
  ctx.fillStyle = "#333";
  ctx.lineWidth = 2;
  ctx.font = "14px sans-serif";
  ctx.textAlign = "center";

  // Ligne principale
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + rulerLengthPx, y);
  ctx.stroke();

  // Tiques d'extrémité
  ctx.beginPath();
  ctx.moveTo(x, y - 5); ctx.lineTo(x, y + 5);
  ctx.moveTo(x + rulerLengthPx, y - 5); ctx.lineTo(x + rulerLengthPx, y + 5);
  ctx.stroke();

  // Texte
  ctx.fillText(label, x + rulerLengthPx / 2, y - 10);
}

function drawGraphicalScale() {
  // Définition mathématique de l'échelle
  const pixelsPerCm = 10; // 10 pixels = 1 cm (puisque 1 px = 1 mm)
  const scaleLengthCm = 10; // On dessine une règle totale de 10 cm
  const totalWidthPx = scaleLengthCm * pixelsPerCm;

  // Position en bas à gauche du canevas
  const startX = 20;
  const startY = canvas.height - 30;

  // 1. Fond semi-transparent pour garantir la lisibilité sur n'importe quel maillage
  ctx.fillStyle = "rgba(255, 255, 255, 0.85)";
  ctx.fillRect(startX - 15, startY - 25, totalWidthPx + 35, 40);

  // 2. Ligne horizontale principale
  ctx.strokeStyle = "#222";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(startX, startY);
  ctx.lineTo(startX + totalWidthPx, startY);
  ctx.stroke();

  // 3. Dessin des graduations
  ctx.fillStyle = "#222";
  ctx.font = "bold 11px sans-serif";
  ctx.textAlign = "center";

  for (let i = 0; i <= scaleLengthCm; i++) {
    const xPos = startX + (i * pixelsPerCm);
    
    ctx.beginPath();
    ctx.moveTo(xPos, startY);
    
    // Grande graduation et texte tous les 5 cm (0, 5, 10)
    if (i % 5 === 0) {
      ctx.lineTo(xPos, startY - 8); // Trait plus long
      ctx.fillText(`${i} cm`, xPos, startY - 12); // Étiquette
    } 
    // Petite graduation pour chaque 1 cm
    else {
      ctx.lineTo(xPos, startY - 4); // Trait court
    }
    ctx.stroke();
  }
}

export function redraw() {
  //Recalcul du centre de gravité de la lame
  if (blade.contour.length > 0 && blade.kinematics && blade.kinematics.velocity && appState.mode !== "simulation") {
    const vel = blade.kinematics.velocity;
    
    // Sauvegarde du vecteur
    const vx = vel.endX - vel.startX || 0;
    const vy = vel.endY - vel.startY || 0;

    // Calcul du barycentre
    let sumX = 0, sumY = 0;
    blade.contour.forEach(p => { 
      sumX += p.x; 
      sumY += p.y; 
    });
    const centerX = sumX / blade.contour.length;
    const centerY = sumY / blade.contour.length;

    // Réassignation des coordonnées
    vel.startX = centerX;
    vel.startY = centerY;
    vel.endX = centerX + vx;
    vel.endY = centerY + vy;
  }

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
  drawScaleRuler();
  drawGraphicalScale();
}