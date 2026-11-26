import { Modifier } from "./Modifier";

export class Attribute {
  public base: number;
  public current: number;
  public modifiers: Map<string, Modifier> = new Map();

  constructor(base: number) {
    this.base = base;
    this.current = base;
  }

  public addModifier(sourceId: string, modifier: Modifier) {
    this.modifiers.set(sourceId, modifier);
    this.recalculate();
  }

  public removeModifier(sourceId: string) {
    this.modifiers.delete(sourceId);
    this.recalculate();
  }

  public recalculate() {
    this.current = this.base;

    const sortedModifiers = Array.from(this.modifiers.values()).sort(
      (a, b) => a.applyMethod - b.applyMethod,
    );

    for (const mod of sortedModifiers) {
      this.current = mod.apply(this.current);
    }
  }
}
