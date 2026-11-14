import { Graphics } from "pixi.js";

const keys: Record<string, boolean> = {};

var touchX = -1;
var touchY = -1;
function processTouch(e:TouchEvent) {
  if (e.type == 'end') {
  }
  else {
    touchX = e.touches.item(0)?.pageX || touchX;
    touchY = e.touches.item(0)?.pageY || touchY;
  }
}

window.addEventListener("touchstart", processTouch);
window.addEventListener("touchmove", processTouch);
window.addEventListener("touchend", processTouch);

// Listen for key presses and releases
window.addEventListener("keydown", (e) => {
  // Prevent default scrolling for arrow keys/space
  if (
    ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"].includes(
      e.code,
    )
  ) {
    e.preventDefault();
  }
  keys[e.code] = true;
});

window.addEventListener("keyup", (e) => {
  keys[e.code] = false;
});

// 1. Get X movement (-1, 0, or 1)
export function getMoveX(sprite:Graphics): -1 | 0 | 1 {
  let x: -1 | 0 | 1 = 0;

  if (touchX !== -1) {
    if (sprite.x-10 > touchX) x = -1;
    if (sprite.x+10 < touchX) x = 1;
    return x;
  }

  if (keys["ArrowLeft"] || keys["KeyA"]) x = -1;
  if (keys["ArrowRight"] || keys["KeyD"]) x = 1;
  return x;
}

// 2. Get Y movement (-1, 0, or 1)
export function getMoveY(sprite:Graphics): -1 | 0 | 1 {
  let y: -1 | 0 | 1 = 0;

  if (touchY !== -1) {
    if (sprite.y-10 > touchY) y = -1;
    if (sprite.y+10 < touchY) y = 1;
    return y;
  }

  if (keys["ArrowUp"] || keys["KeyW"]) y = -1;
  if (keys["ArrowDown"] || keys["KeyS"]) y = 1;
  return y;
}

// 3. Check for Interact key (E or Spacebar)
export function isInteractKeyPressed(): boolean {
  return keys["KeyE"] || keys["Space"] || false;
}
