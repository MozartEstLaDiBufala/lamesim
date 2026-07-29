import { blade, obstacle, appState, materialsDB, simulationState } from './state.js';
import { isPointInRect } from './mathUtils.js';

export const canvas = document.getElementById("canvas");
export const ctx = canvas.getContext("2d");

function getStressColor(stress, maxStress, baseColor) {
  if (!maxStress || stress <= 0 || (stress / maxStress) < 0.1) return baseColor;
  const ratio = Math.min(1, Math.max(0, stress / maxStress));
  return `hsla(${(1 - ratio) * 60}, 100%, 50%, 0.85)`;
}

function drawEntity(target) {
  let contourToDraw = target.contour; 
  let meshVertices = target.mesh.vertices;
  let activeStresses = null;

  if (appState.mode === "simulation" && simulationState.buffer.length > 0) {
    const frameData = simulationState.buffer[simulationState.currentIndex].data[target.type];
    if (frameData && frameData.vertices && frameData.vertices.length > 0) {
      contourToDraw = frameData.vertices;
      meshVertices = frameData.vertices;
      activeStresses = frameData.peak_stresses;
    }
  }

  if (contourToDraw.length > 0) {
    ctx.strokeStyle = target.type === "blade" ? "#333" : "#004085";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(contourToDraw[0].x, contourToDraw[0].y);
    for (let i = 1; i < contourToDraw.length; i++) ctx.lineTo(contourToDraw[i].x, contourToDraw[i].y);
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
    
    if ((!target.isClosed || appState.showMeshLines) && appState.mode !== "simulation") {
      ctx.fillStyle = target.type === "blade" ? "blue" : "darkcyan";
      contourToDraw.forEach(p => {
        ctx.beginPath(); ctx.arc(p.x, p.y, 4, 0, Math.PI * 2); ctx.fill();
      });
    }
  }

  if (target.isClosed && target.mesh.elements.length > 0) {
    let maxStress = activeStresses ? Math.max(...activeStresses) : 0;
    target.mesh.elements.forEach((element, triIndex) => {
      let baseColor = materialsDB[element.material] ? materialsDB[element.material].color : "rgba(180, 180, 180, 0.7)";
      ctx.fillStyle = (activeStresses && activeStresses[triIndex] !== undefined) ? getStressColor(activeStresses[triIndex], maxStress, baseColor) : baseColor;
      ctx.beginPath();
      ctx.moveTo(meshVertices[element.nodes[0]].x, meshVertices[element.nodes[0]].y);
      ctx.lineTo(meshVertices[element.nodes[1]].x, meshVertices[element.nodes[1]].y);
      ctx.lineTo(meshVertices[element.nodes[2]].x, meshVertices[element.nodes[2]].y);
      ctx.closePath();
      ctx.fill(); 
      if (appState.showMeshLines) {
        ctx.strokeStyle = target.type === "blade" ? "#999" : "#87CEFA";
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    });
  }

  if (target.type === "blade" && target.fixations && target.fixations.length > 0) {
    target.fixations.forEach(rect => {
      ctx.fillStyle = "rgba(0, 255, 0, 0.2)"; ctx.strokeStyle = "rgba(0, 200, 0, 0.5)";
      ctx.fillRect(rect.x, rect.y, rect.w, rect.h); ctx.strokeRect(rect.x, rect.y, rect.w, rect.h);
    });
    ctx.fillStyle = "lime";
    meshVertices.forEach(v => {
      if (target.fixations.some(rect => isPointInRect(v.x, v.y, rect))) {
        ctx.beginPath(); ctx.arc(v.x, v.y, 4, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      }
    });
  }
}

export function redraw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawEntity(blade);
  drawEntity(obstacle);

  if (blade.isClosed && blade.kinematics.velocity) {
    const v = blade.kinematics.velocity;
    ctx.strokeStyle = "red"; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(v.startX, v.startY); ctx.lineTo(v.endX, v.endY); ctx.stroke();
    const angle = Math.atan2(v.endY - v.startY, v.endX - v.startX);
    ctx.beginPath();
    ctx.moveTo(v.endX, v.endY);
    ctx.lineTo(v.endX - 15 * Math.cos(angle - Math.PI / 6), v.endY - 15 * Math.sin(angle - Math.PI / 6));
    ctx.lineTo(v.endX - 15 * Math.cos(angle + Math.PI / 6), v.endY - 15 * Math.sin(angle + Math.PI / 6));
    ctx.fillStyle = "red"; ctx.fill();
  }

  if (appState.mode === "add_segment" && appState.segmentStart) {
    ctx.fillStyle = "orange";
    ctx.beginPath(); ctx.arc(appState.segmentStart.point.x, appState.segmentStart.point.y, 6, 0, Math.PI * 2); ctx.fill();
  }
  updateDataPanel();
}

function generateEntityTable(entity, title) {
  // [Code de génération HTML inchangé, omis par concision]
  return `<div><h4>${title}</h4></div>`; 
}

export function updateDataPanel() {
  const dataContent = document.getElementById("data-content");
  if (dataContent) dataContent.innerHTML = generateEntityTable(blade, "Lame") + `<hr>` + generateEntityTable(obstacle, "Bûche");
}

