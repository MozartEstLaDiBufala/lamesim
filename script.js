const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");

const hache = {
  x: 250, y: 150,
  width: 100, height: 100,
};

// Fonction de dessin de la hache (forme très simple)
function drawHache() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Manche
  ctx.fillStyle = "#8B4513";
  ctx.fillRect(hache.x + 40, hache.y + 60, 20, 150);

  // Lame
  ctx.fillStyle = "#aaa";
  ctx.beginPath();
  ctx.moveTo(hache.x, hache.y);
  ctx.lineTo(hache.x + hache.width, hache.y + hache.height / 2);
  ctx.lineTo(hache.x, hache.y + hache.height);
  ctx.closePath();
  ctx.fill();
}

let impact = null;

function drawImpact() {
  if (!impact) return;

  const radius = impact.r;
  ctx.beginPath();
  ctx.arc(impact.x, impact.y, radius, 0, 2 * Math.PI);
  ctx.strokeStyle = `rgba(255, 0, 0, ${1 - radius / 100})`;
  ctx.lineWidth = 3;
  ctx.stroke();

  impact.r += 2;
  if (impact.r > 100) impact = null;
}

canvas.addEventListener("click", function (e) {
  const rect = canvas.getBoundingClientRect();
  const clickX = e.clientX - rect.left;
  const clickY = e.clientY - rect.top;

  // Vérifie si clic sur la lame
  if (
    clickX > hache.x &&
    clickX < hache.x + hache.width &&
    clickY > hache.y &&
    clickY < hache.y + hache.height
  ) {
    impact = { x: clickX, y: clickY, r: 1 };
  }
});

function animate() {
  drawHache();
  drawImpact();
  requestAnimationFrame(animate);
}

animate();
