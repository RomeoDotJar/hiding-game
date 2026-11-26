import { EntitySystem, Matcher, Entity } from "@esengine/ecs-framework";
import { WorldMap } from "../../world/WorldMap";
import {
  ColliderComponent,
  PlayerComponent,
  SightComponent,
  TransformComponent,
} from "../components";
import { lineIntersectsCircle } from "../../world/utils/mathUtils";

export class SightSystem extends EntitySystem {
  constructor(private worldMap: WorldMap) {
    super(Matcher.all(TransformComponent, SightComponent));
  }

  protected process(viewers: readonly Entity[]): void {
    // For this to work, you need a list of all potential targets (e.g., all players).
    // You can inject this list or query the scene for entities with a specific tag.
    if (!this.scene) return;

    const blockers = this.scene.querySystem.queryAll(
      TransformComponent,
      ColliderComponent,
    ).entities;
    const targets = this.scene.querySystem.queryAll(
      TransformComponent,
      PlayerComponent,
    ).entities;

    for (const viewer of viewers) {
      const vTransform = viewer.getComponent(TransformComponent)!;
      const vSight = viewer.getComponent(SightComponent)!;

      vSight.seenIds = [];

      for (const target of targets) {
        if (viewer === target) continue;
        const tTransform = target.getComponent(TransformComponent)!;

        const dx = tTransform.x - vTransform.x;
        const dy = tTransform.y - vTransform.y;
        const distance = Math.sqrt(dx * dx + dy * dy);

        // 1. Range Check
        if (distance > vSight.range) continue;

        // 2. FOV Check
        const angleToTarget = Math.atan2(dy, dx);
        let angleDiff = Math.abs(angleToTarget - vSight.direction);
        if (angleDiff > Math.PI) angleDiff = Math.PI * 2 - angleDiff;
        if (angleDiff > (vSight.angle * Math.PI) / 180 / 2) continue;

        // 3. Wall Raycast
        const wallHit = this.worldMap.raycast(
          vTransform.x,
          vTransform.y,
          tTransform.x,
          tTransform.y,
        );
        if (wallHit !== null) continue; // Wall blocks the view

        // 4. Entity Blocking Check
        let blockedByEntity = false;
        for (const blocker of blockers) {
          if (blocker === viewer || blocker === target) continue;

          const bTransform = blocker.getComponent(TransformComponent)!;
          const bCollider = blocker.getComponent(ColliderComponent)!;

          if (
            lineIntersectsCircle(
              vTransform.x,
              vTransform.y,
              tTransform.x,
              tTransform.y,
              bTransform.x,
              bTransform.y,
              bCollider.radius, // Assuming radius was in tiles, adjust if in pixels
            )
          ) {
            blockedByEntity = true;
            break;
          }
        }

        // 5. If not blocked, add to seen IDs
        if (!blockedByEntity) {
          vSight.seenIds.push(target.id);
        }
      }
    }
  }
}
