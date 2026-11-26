import { Graphics, Container } from "pixi.js";
import { WorldMap } from "../shared/world/WorldMap";
import {
  ColliderComponent,
  SightComponent,
  TransformComponent,
} from "../shared/simulation/components";
import { Entity } from "@esengine/ecs-framework";
import { lineIntersectsCircle } from "../shared/world/utils/mathUtils";
import { TILE_HEIGHT, TILE_WIDTH } from "../shared/world/MapGeometry";

export class VisionRenderer {
  private graphics: Graphics;

  constructor(private layer?: Container) {
    this.graphics = new Graphics();
    if (this.layer) this.layer.addChild(this.graphics);
  }

  public draw(
    worldMap: WorldMap,
    playerX: number,
    playerY: number,
    sight: SightComponent,
    allEntities: readonly Entity[], // Pass the current ECS entities
  ) {
    this.graphics.clear();
    const maxRange = sight.range;
    const halfFov = (sight.angle * Math.PI) / 180 / 2;
    const steps = 360; // More steps = smoother shadows

    const points: { x: number; y: number }[] = [];

    for (let i = 0; i <= steps; i++) {
      // Calculate ray angle based on sight direction and FOV
      const angle = sight.direction - halfFov + (i / steps) * (halfFov * 2);

      let rayEndX = playerX + Math.cos(angle) * maxRange;
      let rayEndY = playerY + Math.sin(angle) * maxRange;

      // 1. Check for Wall Collision
      const wallHit = worldMap.raycast(playerX, playerY, rayEndX, rayEndY);

      const addPixels = TILE_WIDTH + TILE_HEIGHT;

      if (wallHit) {
        rayEndX =
          wallHit.x +
          Math.max(
            -addPixels / 2,
            Math.min(
              addPixels / 2,
              ((rayEndX - playerX) / maxRange) * addPixels,
            ),
          );
        rayEndY =
          wallHit.y +
          Math.max(
            -addPixels / 2,
            Math.min(
              addPixels / 2,
              ((rayEndY - playerY) / maxRange) * addPixels,
            ),
          );
      }

      // 2. Check for Entity Collision
      // We need to find the *closest* blocking entity along this ray.
      let closestEntityDistSq = Infinity;

      for (const entity of allEntities) {
        if (entity.name === "Player_Local") continue; // Don't block sight on yourself

        const t = entity.getComponent(TransformComponent);
        const c = entity.getComponent(ColliderComponent);
        if (!t || !c) continue;

        if (
          lineIntersectsCircle(
            playerX,
            playerY,
            rayEndX,
            rayEndY,
            t.x,
            t.y,
            c.radius,
          )
        ) {
          // If the ray hits an entity, calculate exactly where to stop the ray
          // (Simplified: we stop at the center of the entity for now. For perfect tangents, use exact math)
          const dx = t.x - playerX;
          const dy = t.y - playerY;
          const distSq = dx * dx + dy * dy;
          if (distSq < closestEntityDistSq) {
            closestEntityDistSq = distSq;

            // Snap ray end to the edge of the entity's circle
            const dist = Math.sqrt(distSq);
            const rad = c.radius;
            rayEndX = t.x - (dx / dist) * rad;
            rayEndY = t.y - (dy / dist) * rad;
          }
        }
      }

      points.push({ x: rayEndX, y: rayEndY });
    }

    // Draw the Polygon
    this.graphics.moveTo(playerX, playerY);
    for (const pt of points) {
      this.graphics.lineTo(pt.x, pt.y);
    }
    this.graphics.closePath();

    // Fill with white, which will be used as a mask
    this.graphics.fill(0xffffff);
  }

  public getGraphics() {
    return this.graphics;
  }
}
