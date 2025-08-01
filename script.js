const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');

let gridSize = 20;
let mode = 'lame'; // 'lame', 'force', 'erase'
let isMouseDown = false;
let forceDirection = null;
let forceNumb = 1000;

const lamePoints = new Set();
const forcePoints = new Set();

canvas.addEventListener('mousedown', () => isMouseDown = true);
canvas.addEventListener('mouseup', () => isMouseDown = false);
canvas.addEventListener('mouseleave', () => isMouseDown = false);
canvas.addEventListener('mousemove', drawPoint);
canvas.addEventListener('click', drawPoint);

function gridKey(x, y) {
  return `${x},${y}`;
}

function drawPoint(e) {
  if (!isMouseDown && e.type === 'mousemove') return;

  const rect = canvas.getBoundingClientRect();
  const x = Math.floor((e.clientX - rect.left) / gridSize);
  const y = Math.floor((e.clientY - rect.top) / gridSize);
  const key = gridKey(x, y);

  if (mode === 'lame') {
    lamePoints.add(key);
    forcePoints.delete(key);
  } else if (mode === 'force') {
    forcePoints.add(key);
    lamePoints.delete(key);
  } else if (mode === 'erase') {
    lamePoints.delete(key);
    forcePoints.delete(key);
  }

  redraw();
}

function redraw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawGrid();

  for (const key of lamePoints) {
    const [x, y] = key.split(',').map(Number);
    drawCell(x, y, 'blue');
  }

  for (const key of forcePoints) {
    const [x, y] = key.split(',').map(Number);
    drawCell(x, y, 'red');
    drawForceArrow(x, y, forceDirection);
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
  redraw();
}

function drawForceArrow(x, y, dir) {
  if (!dir) return;

  const cx = x * gridSize + gridSize / 2;
  const cy = y * gridSize + gridSize / 2;
  const len = gridSize / 2;

  let dx = 0, dy = 0;
  switch (dir) {
    case 'up': dy = -1; break;
    case 'down': dy = 1; break;
    case 'left': dx = -1; break;
    case 'right': dx = 1; break;
    case 'up-left': dx = -1; dy = -1; break;
    case 'up-right': dx = 1; dy = -1; break;
    case 'down-left': dx = -1; dy = 1; break;
    case 'down-right': dx = 1; dy = 1; break;
  }

  const angle = Math.atan2(dy, dx);
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


function resizeCanvas() {
  canvas.width = window.innerWidth*0.9;
  canvas.height = window.innerHeight*0.92;
  redraw();
}

function changeForceNumb(newSize) {
  forceNumb = parseInt(newSize);
  redraw();
}

console.log("a");
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

redraw();


console.log("b");