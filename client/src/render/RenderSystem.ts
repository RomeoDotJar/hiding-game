import { EntitySystem, Matcher, Entity } from "@esengine/ecs-framework";
import { Container, Graphics, Text, TextStyle } from "pixi.js";
import { TILEMAP_UPSCALE } from "../shared/constants.js";
import {
  BulletComponent,
  PlayerComponent,
  TransformComponent,
} from "../shared/simulation/components.js";

export class RenderSystem extends EntitySystem {
  private container: Container | undefined;
  private sprites: Map<Entity, Graphics> = new Map();

  constructor() {
    super(Matcher.all(TransformComponent));
  }

  public setStage(stage: Container) {
    this.container = stage;
  }

  protected process(entities: readonly Entity[]): void {
    if (!this.container) return;

    for (const entity of entities) {
      const transform = entity.getComponent(TransformComponent)!;
      const player = entity.getComponent(PlayerComponent);
      const bullet = entity.getComponent(BulletComponent);
      let sprite = this.sprites.get(entity);

      // 1. Create sprite if it doesn't exist
      if (!sprite) {
        sprite = new Graphics();

        if (player) {
          const style = new TextStyle({
            fontFamily: "Consolas,Arial",
            fontSize: 12,
            fill: 0xffffff,
            stroke: { color: 0x000000, width: 2 },
          });

          const label = new Text({
            text: entity.name.split("_")[1].substring(0, 4) || "",
            style,
          });
          label.resolution = 2;

          label.anchor.set(0.5, 1);
          label.y = -12;

          sprite.addChild(label);
          sprite.rect(-10, -10, 20, 20).fill(0x00ff00);
        } else if (bullet) {
          sprite.circle(0, 0, 4).fill(0xff0000);
        } else {
          sprite.rect(-4, -4, 8, 8).fill(0xffffff); // Default fallback
        }

        this.container.addChild(sprite);
        this.sprites.set(entity, sprite);
      }

      // 2. Sync Position
      sprite.x = transform.x * TILEMAP_UPSCALE;
      sprite.y = transform.y * TILEMAP_UPSCALE;
    }

    for (const [entity, sprite] of this.sprites) {
      if (!entities.includes(entity)) {
        sprite.destroy();
        this.sprites.delete(entity);
      }
    }
  }

  public onDestroy(): void {
    super.onDestroy();

    for (const [entity, sprite] of this.sprites) {
      sprite.destroy();
      this.sprites.delete(entity);
    }
  }
}
