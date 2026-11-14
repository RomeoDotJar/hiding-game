import type { MoveInput } from "./MoveInput";


// A simple interface for a player entity
export interface PlayerEntity {
  x: number;
  y: number;
  isInteracting: boolean;
}

// The deterministic step function. Run this on BOTH client and server.
export function applyInput(player: PlayerEntity, cmd: MoveInput, dt: number) {
  // 1. Movement (simple example: speed of 100 units per second)
  const speed = 200;
  player.x += cmd.moveX * speed * dt;
  player.y += cmd.moveY * speed * dt;

  // 2. Interact action
  // We set a flag. The server can later check this flag to validate interactions.
  player.isInteracting = cmd.interact;

  // (Optional: Add boundary checks, collision logic, etc. here)
}