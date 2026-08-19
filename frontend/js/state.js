export const materialsDB = {
  "steel": { name: "Acier", color: "rgba(180, 180, 180, 0.7)" },
  "wood":  { name: "Bois de Frêne", color: "rgba(139, 69, 19, 0.7)" }
};

export const blade = {
  type: "blade",
  contour: [],
  regions: [],
  internalEdges: [],
  fixations: [],
  isClosed: false,
  mesh: { vertices: [], elements: [] },
  physics: { centroid: { x: 0, y: 0 }, area: 0, mass: 1.0, stresses: [] },
  kinematics: { velocity: null,   impactSpeed: 15.0 }
};

export const obstacle = {
  type: "obstacle",
  contour: [],
  regions: [],
  internalEdges: [],
  isClosed: false,
  mesh: { vertices: [], elements: [] },
  physics: { centroid: { x: 0, y: 0 }, area: 0, mass: 0 }
};

export const appState = {
  mode: "draw_blade",
  currentMaterial: "steel",
  showPointMeshLines: true,        // État pour le bouton existant
  showMeasurements: false,  // Nouvel état pour les mesures
  draggedPoint: null,
  activeTarget: null,
  segmentStart: null,
  fixationStart: null
};

export const historyManager = {
  undoStack: [],
  redoStack: [],
  maxSize: 30
};

export const simulationState = {
  buffer: [],
  currentIndex: 0
};

export let simulationParams = {
  timeStep: 0.001,
  numSteps: 50
};

// Fonction pour écraser les données (utilisée par l'historique et l'import JSON)
export function overwriteState(newBlade, newObstacle) {
  Object.assign(blade, newBlade);
  Object.assign(obstacle, newObstacle);
}

export const ruler = {
  visible: true,
  p1: { x: 100, y: 100 },
  p2: { x: 300, y: 100 },
  hoveredPart: null, // Peut être "p1", "p2", "line" ou null
  isDragging: false,
  dragOffsetX: 0,
  dragOffsetY: 0,
  lineDX: 0,
  lineDY: 0
};