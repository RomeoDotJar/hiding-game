export function lineIntersectsCircle(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  cx: number,
  cy: number,
  radius: number,
): boolean {
  const dx = x2 - x1;
  const dy = y2 - y1;

  // If the line has no length, check distance to center directly
  if (dx === 0 && dy === 0) {
    return Math.hypot(cx - x1, cy - y1) <= radius;
  }

  const t = ((cx - x1) * dx + (cy - y1) * dy) / (dx * dx + dy * dy);

  // Closest point on the line segment is outside the bounds (clamped to endpoints)
  const closestX = x1 + Math.max(0, Math.min(1, t)) * dx;
  const closestY = y1 + Math.max(0, Math.min(1, t)) * dy;

  return Math.hypot(cx - closestX, cy - closestY) <= radius;
}
