export enum CollisionLayer {
  None = 0,
  Wall = 1 << 0,
  Player = 1 << 1,
  Monster = 1 << 2,
  Bullet = 1 << 3,
  Interactable = 1 << 4,
  InteractablePhasable = 1 << 5,
}

const cl = CollisionLayer;

export const DEFAULT_COLLISIONS = cl.Wall | cl.Monster | cl.Interactable;
export const DEFAULT_PLAYER_COLLISIONS =
  cl.Wall | cl.Monster | cl.Bullet | cl.Interactable;
export const DEFAULT_BULLET_COLLISIONS =
  cl.Wall | cl.Player | cl.Monster | cl.Interactable;
