import type { AttributeComponent } from "../components.js";

export interface IStatusEffect {
  name: string;
  duration: number;
  potency: number;

  // Runs when the effect is added or potency changes
  inflict(attrs: AttributeComponent, potency: number): void;
  // Runs every tick
  tick(attrs: AttributeComponent, dt: number): void;
  // Runs when the effect expires
  expire(attrs: AttributeComponent): void;
}
