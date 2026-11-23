import { Graphics } from "pixi.js";

const TOUCH_FREE_SPACE = 30;
const keys: Record<string, boolean> = {};

let touchX = -1;
let touchY = -1;

let lastSpriteX = -1;
let lastSpriteY = -1;

let holding = false;

function processTouch(e: TouchEvent) {
  if (e.type !== "touchend") {
    touchX = e.touches.item(0)?.pageX || touchX;
    touchY = e.touches.item(0)?.pageY || touchY;
    
    lastSpriteX = -1;
    lastSpriteY = -1;

    holding = true;
  }
  else {
    holding = false;
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

  touchX = -1;
  touchY = -1;
});

window.addEventListener("keyup", (e) => {
  keys[e.code] = false;
});

// 1. Get X movement (-1, 0, or 1)
export function getMoveX(spriteX: number, mapX: number): -1 | 0 | 1 {
  let x: -1 | 0 | 1 = 0;

  if (touchX !== -1) {
    let deltaFromSpriteX = touchX - spriteX-mapX;
    
    if (lastSpriteX === -1 || holding)
      lastSpriteX = spriteX+deltaFromSpriteX;

    let usedFreeSpace = holding ? TOUCH_FREE_SPACE*2 : TOUCH_FREE_SPACE

    if (Math.abs(spriteX - lastSpriteX) < TOUCH_FREE_SPACE && !holding)
      touchX = -1;

    if (spriteX+mapX - usedFreeSpace > touchX) x = -1;
    if (spriteX+mapX + usedFreeSpace < touchX) x = 1;
    return x;
  }

  if (keys["ArrowLeft"] || keys["KeyA"]) x = -1;
  if (keys["ArrowRight"] || keys["KeyD"]) x = 1;
  return x;
}

// 2. Get Y movement (-1, 0, or 1)
export function getMoveY(spriteY: number, mapY: number): -1 | 0 | 1 {
  let y: -1 | 0 | 1 = 0;

  if (touchY !== -1) {
    let deltaFromSpriteY = touchY - spriteY-mapY;
    
    if (lastSpriteY === -1 || holding)
      lastSpriteY = spriteY+deltaFromSpriteY;

    if (Math.abs(spriteY - lastSpriteY) < TOUCH_FREE_SPACE && !holding)
      touchY = -1;

    if (spriteY+mapY - TOUCH_FREE_SPACE > touchY) y = -1;
    if (spriteY+mapY + TOUCH_FREE_SPACE < touchY) y = 1;
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
