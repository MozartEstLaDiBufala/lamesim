export function distance(x1, y1, x2, y2) {
  return Math.hypot(x2 - x1, y2 - y1);
}

export function calculateCentroid(pointsArray) {
  if (pointsArray.length < 3) return { x: 0, y: 0, area: 0 };
  let area = 0, cx = 0, cy = 0;
  for (let i = 0; i < pointsArray.length; i++) {
    let j = (i + 1) % pointsArray.length;
    let factor = (pointsArray[i].x * pointsArray[j].y) - (pointsArray[j].x * pointsArray[i].y);
    area += factor;
    cx += (pointsArray[i].x + pointsArray[j].x) * factor;
    cy += (pointsArray[i].y + pointsArray[j].y) * factor;
  }
  area /= 2;
  return { x: cx / (6 * area), y: cy / (6 * area), area: Math.abs(area) };
}

export function isPointInTriangle(px, py, ax, ay, bx, by, cx, cy) {
  let v0x = cx - ax, v0y = cy - ay;
  let v1x = bx - ax, v1y = by - ay;
  let v2x = px - ax, v2y = py - ay;
  let dot00 = v0x * v0x + v0y * v0y;
  let dot01 = v0x * v1x + v0y * v1y;
  let dot02 = v0x * v2x + v0y * v2y;
  let dot11 = v1x * v1x + v1y * v1y;
  let dot12 = v1x * v2x + v1y * v2y;
  let invDenom = 1 / (dot00 * dot11 - dot01 * dot01);
  let u = (dot11 * dot02 - dot01 * dot12) * invDenom;
  let v = (dot00 * dot12 - dot01 * dot02) * invDenom;
  return (u >= 0) && (v >= 0) && (u + v < 1);
}

export function pointToSegmentDistance(px, py, ax, ay, bx, by) {
  const l2 = (bx - ax) ** 2 + (by - ay) ** 2;
  if (l2 === 0) return distance(px, py, ax, ay);
  let t = Math.max(0, Math.min(1, ((px - ax) * (bx - ax) + (py - ay) * (by - ay)) / l2));
  return distance(px, py, ax + t * (bx - ax), ay + t * (by - ay));
}

export function isPointInRect(px, py, rect) {
  const minX = Math.min(rect.x, rect.x + rect.w);
  const maxX = Math.max(rect.x, rect.x + rect.w);
  const minY = Math.min(rect.y, rect.y + rect.h);
  const maxY = Math.max(rect.y, rect.y + rect.h);
  return px >= minX && px <= maxX && py >= minY && py <= maxY;
}