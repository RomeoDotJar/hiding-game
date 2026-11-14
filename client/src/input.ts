const keys: Record<string, boolean> = {};

// Listen for key presses and releases
window.addEventListener('keydown', (e) => {
  // Prevent default scrolling for arrow keys/space
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) {
    e.preventDefault(); 
  }
  keys[e.code] = true;
});

window.addEventListener('keyup', (e) => {
  keys[e.code] = false;
});

// 1. Get X movement (-1, 0, or 1)
export function getMoveX(): -1 | 0 | 1 {
  let x: -1 | 0 | 1 = 0;
  if (keys['ArrowLeft'] || keys['KeyA']) x = -1;
  if (keys['ArrowRight'] || keys['KeyD']) x = 1;
  return x;
}

// 2. Get Y movement (-1, 0, or 1)
export function getMoveY(): -1 | 0 | 1 {
  let y: -1 | 0 | 1 = 0;
  if (keys['ArrowUp'] || keys['KeyW']) y = -1;
  if (keys['ArrowDown'] || keys['KeyS']) y = 1;
  return y;
}

// 3. Check for Interact key (E or Spacebar)
export function isInteractKeyPressed(): boolean {
  return keys['KeyE'] || keys['Space'] || false;
}