const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");
const addBtn = document.getElementById("addForce");
const trash = document.getElementById("trash");

let arrows = [];
let draggingPoint = null;

function drawHache() {
  ctx.fillStyle = "#999";
  ctx.beginPath();
  ctx.moveTo(300, 200);
  ctx.lineTo(400, 250);
  ctx.lineTo(300, 300);
  ctx.closePath();
  ctx.fill();
}

function drawArrow(arrow, index) {
  const { startX, startY, endX, endY } = arrow;

  const dx = endX - startX;
  const dy = endY - startY;
  const length = Math.sqrt(dx * dx + dy * dy);
  const angle = Math.atan2(dy, dx);

  ctx.strokeStyle = "red";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(startX, startY);
  ctx.lineTo(endX, endY);
  ctx.stroke();

  // Tête de flèche
  ctx.beginPath();
  ctx.moveTo(endX, endY);
  ctx.lineTo(endX - 10 * Math.cos(angle - 0.3), endY - 10 * Math.sin(angle - 0.3));
  ctx.lineTo(endX - 10 * Math.cos(angle + 0.3), endY - 10 * Math.sin(angle + 0.3));
  ctx.closePath();
  ctx.fillStyle = "red";
  ctx.fill();

  // Affiche force en N
  ctx.fillStyle = "black";
  ctx.font = "14px sans-serif";
  ctx.fillText(`${Math.round(length)} N`, startX + dx / 2, startY + dy / 2 - 10);
}

function redraw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawHache();
  arrows.forEach(drawArrow);
}

canvas.addEventListener("mousedown", (e) => {
  const rect = canvas.getBoundingClientRect();
  const mx = e.clientX - rect.left;
  const my = e.clientY - rect.top;

  arrows.forEach((arrow, index) => {
    if (distance(mx, my, arrow.startX, arrow.startY) < 10) {
      draggingPoint = { arrow, point: "start" };
    } else if (distance(mx, my, arrow.endX, arrow.endY) < 10) {
      draggingPoint = { arrow, point: "end" };
    }
  });
});

canvas.addEventListener("mousemove", (e) => {
  if (!draggingPoint) return;
  const rect = canvas.getBoundingClientRect();
  const mx = e.clientX - rect.left;
  const my = e.clientY - rect.top;
  draggingPoint.arrow[draggingPoint.point + "X"] = mx;
  draggingPoint.arrow[draggingPoint.point + "Y"] = my;
  redraw();
});

canvas.addEventListener("mouseup", () => {
  draggingPoint = null;
});

addBtn.addEventListener("click", () => {
  arrows.push({
    startX: 350,
    startY: 250,
    endX: 400,
    endY: 250,
  });
  redraw();
});

function distance(x1, y1, x2, y2) {
  return Math.hypot(x2 - x1, y2 - y1);
}

redraw();
