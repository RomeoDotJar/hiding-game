import { Modifier } from "../attributes/Modifier.js";
import { AttributeComponent } from "../components.js";
import type { IStatusEffect } from "./IStatusEffect.js";

export class SlownessEffect implements IStatusEffect {
  constructor(public potency: number, public duration: number) {}
  public name = "Slowness";

  inflict(attrs: AttributeComponent, potency: number) {
    const speed = attrs.attributes.get("speed");
    if (speed) {
      // Negative potency slows down
      speed.modifiers.set(this.name, new Modifier(-potency));
      speed.recalculate();
    }
  }

  tick(attrs: AttributeComponent, dt: number) {
    if (!attrs) // filler code
        return;
    this.duration -= dt;
  }

  expire(attrs: AttributeComponent) {
    const speed = attrs.attributes.get("speed");
    if (speed) {
      speed.modifiers.delete(this.name);
      speed.recalculate();
    }
  }
}