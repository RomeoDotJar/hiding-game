import { Entity, EntitySystem, Matcher } from "@esengine/ecs-framework";
import {
  TransformComponent,
  VelocityComponent,
  ColliderComponent,
  PlayerComponent,
} from "../components.js";
import { WorldMap } from "../../world/WorldMap.js";
import { resolveAxisCollision } from "../SimulationEngine.js";
import { CollisionLayer } from "../collisionLayers.js";

export class MovementSystem extends EntitySystem {
  private worldMap: WorldMap;
  public dt: number = 1;

  constructor(worldMap: WorldMap) {
    // This system runs on entities that have Transform, Velocity, and Collider
    super(
      Matcher.all(TransformComponent, VelocityComponent, ColliderComponent),
    );
    this.worldMap = worldMap;
  }

  public setDeltaTime(newDt: number) {
    this.dt = newDt;
  }

  protected process(entities: readonly Entity[]): void {
    for (const entity of entities) {
      const transform = entity.getComponent(TransformComponent)!;
      const velocity = entity.getComponent(VelocityComponent)!;
      const collider = entity.getComponent(ColliderComponent)!;

      const player = entity.getComponent(PlayerComponent);

      // Note: The 'dt' is stored in the system or passed via a static context.
      // For simplicity, we'll use a static delta time on the scene, or update it manually.
      // We'll define a custom property for dt that we set before processing.
      const dt = this.dt || 0;

      // 1. Calculate the intended new position
      const nextX = transform.x + velocity.vx * dt;
      const nextY = transform.y + velocity.vy * dt;

      if (collider.canCollide && collider.layer&CollisionLayer.Wall && this.worldMap) {
        // 1. Resolve X-axis movement
        transform.x = resolveAxisCollision(
          this.worldMap,
          transform.x,
          nextX,
          transform.y,
          collider.radius,
          true,
        );

        // 2. Resolve Y-axis movement (using the newly resolved X position)
        transform.y = resolveAxisCollision(
          this.worldMap,
          transform.y,
          nextY,
          transform.x,
          collider.radius,
          false,
        );
      } else {
        // Fallback if no map is loaded yet
        transform.x = nextX;
        transform.y = nextY;
      }
    }
  }
}