import { Player } from "../schema/MyRoomState";
import { resolveAxisCollision } from "../simulation/SimulationEngine";
import { WorldMap } from "../world/WorldMap";
import type { MoveInput } from "./MoveInput";

export function applyInput(
  player: Player,
  cmd: MoveInput,
  dt: number,
  worldMap?: (() => WorldMap | undefined) | undefined,
  radius: number = 2,
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
    player.x = resolveAxisCollision(
      worldMap()!,
      player.x,
      nextX,
      player.y,
      radius,
      true,
    );

    // 2. Resolve Y-axis movement (using the newly resolved X position)
    player.y = resolveAxisCollision(
      worldMap()!,
      player.y,
      nextY,
      player.x,
      radius,
      false,
    );
  } else {
    // Fallback if no map is loaded yet
    player.x = nextX;
    player.y = nextY;
  }
}
