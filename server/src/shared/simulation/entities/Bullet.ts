import { Entity, Scene } from "@esengine/ecs-framework";
import { TransformComponent, VelocityComponent } from "../components.js";

export class Bullet extends Entity {
  public static spawn(scene: Scene, x: number, y: number, vx: number, vy: number): Entity {
    const entity = scene.createEntity("Bullet");
    entity.addComponent(new TransformComponent(x, y));
    entity.addComponent(new VelocityComponent(vx, vy));

    return entity;
  }
}