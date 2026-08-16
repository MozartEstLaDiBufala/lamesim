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

// ---Maillage Adaptatif par Bisection (Algorithme de Rivara) ---
export function refineMeshAdaptive(target, maxEdgeLength = 30) {
  // maxEdgeLength définit la taille maximale tolérée pour une arête (en pixels)
  let needsRefinement = true;
  let iteration = 0;

  // Sécurité limitant la profondeur de récursion pour éviter le blocage du navigateur
  while (needsRefinement && iteration < 2000) { 
    needsRefinement = false;
    let longestEdge = null;
    let maxDist = maxEdgeLength; 

    // Dictionnaire pour stocker les arêtes partagées et éviter les nœuds pendants
    const edges = {}; 

    // 1. Analyse géométrique : Extraction de toutes les arêtes du maillage
    for (let i = 0; i < target.mesh.elements.length; i++) {
      const el = target.mesh.elements[i];
      const n = el.nodes;
      const triEdges = [
        [n[0], n[1]], [n[1], n[2]], [n[2], n[0]]
      ];

      for (let e of triEdges) {
        const minN = Math.min(e[0], e[1]);
        const maxN = Math.max(e[0], e[1]);
        const key = `${minN}_${maxN}`;

        if (!edges[key]) {
          const p1 = target.mesh.vertices[minN];
          const p2 = target.mesh.vertices[maxN];
          const dist = Math.hypot(p2.x - p1.x, p2.y - p1.y);

          edges[key] = { n1: minN, n2: maxN, dist: dist, tris: [i] };

          // Enregistrement de l'arête si elle devient la nouvelle candidate la plus longue
          if (dist > maxDist) {
            maxDist = dist;
            longestEdge = key;
            needsRefinement = true;
          }
        } else {
          // L'arête existe déjà, on associe ce deuxième triangle pour garantir la coupe bilatérale
          edges[key].tris.push(i); 
        }
      }
    }

    // Condition d'arrêt : Le maillage respecte le critère de taille
    if (!needsRefinement || !longestEdge) break;

    // 2. Coupe de l'arête et création du point d'interpolation
    const edgeData = edges[longestEdge];
    const p1 = target.mesh.vertices[edgeData.n1];
    const p2 = target.mesh.vertices[edgeData.n2];

    const t1 = p1.t !== undefined ? parseFloat(p1.t) : 1.0;
    const t2 = p2.t !== undefined ? parseFloat(p2.t) : 1.0;
    
    const midPoint = {
      x: (p1.x + p2.x) / 2,
      y: (p1.y + p2.y) / 2,
      t: (t1 + t2) / 2
    };

    const midIdx = target.mesh.vertices.length;
    target.mesh.vertices.push(midPoint);

    // 3. Remplacement topologique des triangles affectés
    // Tri décroissant obligatoire pour ne pas décaler les index lors du splice
    const trisToReplace = edgeData.tris.sort((a, b) => b - a);
    const newElements = [];

    for (let triIdx of trisToReplace) {
      const el = target.mesh.elements[triIdx];
      const n = el.nodes;
      
      // Identification du sommet opposé à l'arête coupée
      let oppositeNode = -1;
      for (let node of n) {
        if (node !== edgeData.n1 && node !== edgeData.n2) {
          oppositeNode = node;
          break;
        }
      }

      // Génération de 2 sous-triangles parfaits
      newElements.push({ nodes: [edgeData.n1, midIdx, oppositeNode], material: el.material });
      newElements.push({ nodes: [midIdx, edgeData.n2, oppositeNode], material: el.material });

      // Destruction de l'ancien triangle
      target.mesh.elements.splice(triIdx, 1);
    }

    // Intégration des nouveaux éléments au maillage global
    target.mesh.elements.push(...newElements);
    iteration++;
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
    const finalMaterial = target.type === "blade" ? "steel" : "wood";
    // Détermination du matériau final à appliquer lors de la fermeture de la forme
    for (let i = 0; i < earcutIndices.length; i += 3) {
      target.mesh.elements.push({
        nodes: [regionIndices[earcutIndices[i]], regionIndices[earcutIndices[i+1]], regionIndices[earcutIndices[i+2]]],
        material: finalMaterial
      });
    }
  });

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