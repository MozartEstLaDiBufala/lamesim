import { blade, obstacle } from './state.js';
import { distance, pointToSegmentDistance, calculateCentroid } from './mathUtils.js';
import { redraw } from './render.js';

export function findClosestPoint(mx, my, threshold = 15) {
  for (let target of [blade, obstacle]) {
    for (let i = 0; i < target.contour.length; i++) {
      if (distance(mx, my, target.contour[i].x, target.contour[i].y) < threshold) {
        return { target: target, point: target.contour[i], index: i };
      }
    }
  }
  return null;
}

export function findClosestInternalEdge(mx, my, threshold = 12) {
  for (let target of [blade, obstacle]) {
    if (!target.isClosed || !target.internalEdges) continue;
    for (let i = 0; i < target.internalEdges.length; i++) {
      let edge = target.internalEdges[i];
      let p1 = target.contour[edge.p1], p2 = target.contour[edge.p2];
      if (p1 && p2 && pointToSegmentDistance(mx, my, p1.x, p1.y, p2.x, p2.y) < threshold) {
        return { target, index: i };
      }
    }
  }
  return null;
}

export function splitRegionWithoutAddingEdge(target, index1, index2) {
  for (let r = 0; r < target.regions.length; r++) {
    const region = target.regions[r];
    const pos1 = region.indexOf(index1), pos2 = region.indexOf(index2);
    if (pos1 !== -1 && pos2 !== -1) {
      const minPos = Math.min(pos1, pos2), maxPos = Math.max(pos1, pos2);
      if (maxPos - minPos <= 1 || (minPos === 0 && maxPos === region.length - 1)) return false;
      const regionA = [...region.slice(0, minPos + 1), ...region.slice(maxPos)];
      const regionB = region.slice(minPos, maxPos + 1);
      target.regions.splice(r, 1, regionA, regionB);
      return true;
    }
  }
  return false;
}

export function splitRegion(target, index1, index2) {
  if (splitRegionWithoutAddingEdge(target, index1, index2)) {
    target.internalEdges.push({ p1: index1, p2: index2 });
    generateMesh(target);
  }
}

export function rebuildRegionsFromEdges(target) {
  if (target.contour.length < 3) { target.regions = []; return; }
  target.regions = [Array.from({length: target.contour.length}, (_, i) => i)];
  const validEdges = [];
  if (target.internalEdges) {
    for (let edge of target.internalEdges) {
      if (splitRegionWithoutAddingEdge(target, edge.p1, edge.p2)) validEdges.push(edge);
    }
  }
  target.internalEdges = validEdges;
}

// --- NOUVELLE FONCTION : Raffinement FEA par subdivision ---
export function refineMesh(target, levels = 1) {
  for (let lvl = 0; lvl < levels; lvl++) {
    const oldElements = target.mesh.elements;
    const newElements = [];
    
    // Le cache garantit que deux triangles adjacents partagent le même sommet médian.
    // C'est strictement obligatoire pour la matrice de rigidité globale.
    const edgeCache = {};

    const getMidpoint = (idxA, idxB) => {
      const minIdx = Math.min(idxA, idxB);
      const maxIdx = Math.max(idxA, idxB);
      const key = `${minIdx}_${maxIdx}`;

      if (edgeCache[key] !== undefined) {
        return edgeCache[key];
      }

      const pA = target.mesh.vertices[idxA];
      const pB = target.mesh.vertices[idxB];
      
      // Sécurisation des valeurs par défaut pour éviter les erreurs NaN
      const tA = pA.t !== undefined ? parseFloat(pA.t) : 1.0;
      const tB = pB.t !== undefined ? parseFloat(pB.t) : 1.0;

      const midPoint = {
        x: (pA.x + pB.x) / 2,
        y: (pA.y + pB.y) / 2,
        t: pA.t 
      };

      const newIdx = target.mesh.vertices.length;
      target.mesh.vertices.push(midPoint);
      edgeCache[key] = newIdx;
      return newIdx;
    };

    for (let el of oldElements) {
      const n0 = el.nodes[0];
      const n1 = el.nodes[1];
      const n2 = el.nodes[2];

      const m01 = getMidpoint(n0, n1);
      const m12 = getMidpoint(n1, n2);
      const m20 = getMidpoint(n2, n0);

      const mat = el.material;

      // Division d'un triangle parent en 4 triangles enfants
      newElements.push({ nodes: [n0, m01, m20], material: mat });
      newElements.push({ nodes: [n1, m12, m01], material: mat });
      newElements.push({ nodes: [n2, m20, m12], material: mat });
      newElements.push({ nodes: [m01, m12, m20], material: mat });
    }
    target.mesh.elements = newElements;
  }
}

export function generateMesh(target) {
  if (target.contour.length < 3) {
    target.mesh.vertices = []; target.mesh.elements = []; return;
  }
  if (!target.regions || target.regions.length === 0) {
    target.regions = [Array.from({length: target.contour.length}, (_, i) => i)];
  }
  
  // Les sommets de base sont ceux du contour
  target.mesh.vertices = [...target.contour];
  target.mesh.elements = [];
  
  target.regions.forEach(regionIndices => {
    const flatCoords = [];
    regionIndices.forEach(idx => {
      if (target.contour[idx]) flatCoords.push(target.contour[idx].x, target.contour[idx].y);
    });
    if (flatCoords.length < 6) return;
    
    const earcutIndices = earcut(flatCoords); 
    for (let i = 0; i < earcutIndices.length; i += 3) {
      target.mesh.elements.push({
        nodes: [regionIndices[earcutIndices[i]], regionIndices[earcutIndices[i+1]], regionIndices[earcutIndices[i+2]]],
        material: "steel"
      });
    }
  });

  // --- APPLICATION DU RAFFINEMENT ---
  // Le paramètre "1" divise chaque triangle par 4. 
  // Un paramètre "2" diviserait par 16 (attention à la charge de calcul du backend Python).
  refineMesh(target, 1);

  const centroidData = calculateCentroid(target.contour);
  target.physics.centroid = { x: centroidData.x, y: centroidData.y };
  target.physics.area = centroidData.area;

  if (target.type === "blade" && !target.kinematics.velocity) {
    target.kinematics.velocity = { startX: centroidData.x, startY: centroidData.y, endX: centroidData.x, endY: centroidData.y + 100 };
    const vxInput = document.getElementById("input-vx");
    const vyInput = document.getElementById("input-vy");
    if (vxInput) vxInput.value = 0;
    if (vyInput) vyInput.value = 100;
  }
  redraw();
}