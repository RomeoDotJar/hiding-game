import { WorldMap } from "../world/WorldMap";
import type { MoveInput } from "./MoveInput";

/**
 * Helper function to find the exact point before a collision occurs using Binary Search.
 * EXPORTED so the server's MovementSystem can use it too.
 */
export function resolveAxisCollision(
  worldMap: WorldMap,
  startPos: number,
  endPos: number,
  otherPos: number,
  radius: number,
  isXAxis: boolean
): number {
  const checkCollision = (pos: number) =>
    isXAxis
      ? worldMap.checkCircleCollision(pos, otherPos, radius)
      : worldMap.checkCircleCollision(otherPos, pos, radius);

  if (!checkCollision(endPos)) return endPos;
  if (checkCollision(startPos)) return endPos; // Escape if somehow stuck

  let valid = startPos;
  let invalid = endPos;

  for (let i = 0; i < 8; i++) {
    const mid = (valid + invalid) / 2;
    if (checkCollision(mid)) {
      invalid = mid;
    } else {
      valid = mid; 
    }
  }
  return valid;
}

// Use a structural interface so it works with Colyseus Schema AND ESEngine Components
export interface IPhysicsState {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

export function applyInput(
  player: IPhysicsState,
  cmd: MoveInput,
  dt: number,
  worldMap?: (() => WorldMap | undefined) | undefined,
  radius: number = 2
) {
  const speed = 75;
  
  // Store velocity in units per second (NOT units per tick!)
  // This is crucial so remote client extrapolation math works correctly.
  player.vx = cmd.moveX * speed;
  player.vy = cmd.moveY * speed;

  const nextX = player.x + player.vx * dt;
  const nextY = player.y + player.vy * dt;

  if (worldMap && worldMap()) {
    // 1. Resolve X-axis movement
    player.x = resolveAxisCollision(worldMap()!, player.x, nextX, player.y, radius, true);

    // 2. Resolve Y-axis movement (using the newly resolved X position)
    player.y = resolveAxisCollision(worldMap()!, player.y, nextY, player.x, radius, false);
  } else {
    // Fallback if no map is loaded yet
    player.x = nextX;
    player.y = nextY;
  }
}