import { redraw, canvas } from './render.js';
import { initEvents } from './events.js';

function resizeCanvas() {
  const container = document.getElementById("canvas-container");
  if (!container) return;
  
  canvas.width = container.clientWidth;
  const rect = canvas.getBoundingClientRect();
  canvas.height = window.innerHeight - rect.top - 10; 
  
  redraw();
}

// 1. Initialisation des outils et boutons
initEvents();

// 2. Gestion stricte du redimensionnement
window.addEventListener("resize", resizeCanvas);
window.addEventListener("load", resizeCanvas); // Attend que toute la page (CSS inclus) soit prête