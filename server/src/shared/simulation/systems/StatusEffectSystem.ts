import { Entity, EntitySystem, Matcher } from "@esengine/ecs-framework";
import {
  StatusEffectComponent,
  AttributeComponent,
} from "../components.js";

export class StatusEffectSystem extends EntitySystem {
  public dt: number = 0;

  constructor() {
    super(Matcher.all(StatusEffectComponent, AttributeComponent));
  }

  protected process(entities: readonly Entity[]): void {
    for (const entity of entities) {
      const statusComp = entity.getComponent(StatusEffectComponent)!;
      const attrComp = entity.getComponent(AttributeComponent)!;

      for (const [name, effect] of statusComp.effects) {
        effect.tick(attrComp, this.dt);
        
        if (effect.duration <= 0) {
          effect.expire(attrComp);
          statusComp.effects.delete(name);
        }
      }
    }
  }
}