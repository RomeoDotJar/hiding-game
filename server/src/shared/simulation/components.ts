import { Component, ECSComponent } from "@esengine/ecs-framework";
import { CollisionLayer, DEFAULT_COLLISIONS } from "./collisionLayers.js";
import { Attribute } from "./attributes/Attribute.js";
import type { IStatusEffect } from "./effects/IStatusEffect.js";

@ECSComponent("TransformComponent")
export class TransformComponent extends Component {
  constructor(
    public x: number = 0,
    public y: number = 0,
  ) {
    super();
  }
}

@ECSComponent("VelocityComponent")
export class VelocityComponent extends Component {
  constructor(
    public vx: number = 0,
    public vy: number = 0,
  ) {
    super();
  }
}

@ECSComponent("ColliderComponent")
export class ColliderComponent extends Component {
  constructor(
    public radius: number = 2,
    public layer: CollisionLayer = DEFAULT_COLLISIONS,
    public canCollide: boolean = true,
  ) {
    super();
  }
}

@ECSComponent("InteractableComponent")
export class InteractableComponent extends Component {
  constructor(
    public type: "Chest" | "Ritual" | "Closet" | "Door" | "SpawnArea",
    public id: number,
  ) {
    super();
  }
}

@ECSComponent("DoorComponent")
export class DoorComponent extends Component {
  constructor(
    public isOpen: boolean,
    public orientation: "NORTH" | "EAST" | "SOUTH" | "WEST",
  ) {
    super();
  }
}

@ECSComponent("StatusEffectComponent")
export class StatusEffectComponent extends Component {
  public effects: Map<string, IStatusEffect> = new Map();

  public addEffect(effect: IStatusEffect) {
    this.effects.set(effect.name, effect);
  }
}

@ECSComponent("AttributeComponent")
export class AttributeComponent extends Component {
  public attributes: Map<string, Attribute> = new Map();

  constructor(initialAttributes: Record<string, number>) {
    super();
    for (const [key, value] of Object.entries(initialAttributes)) {
      this.attributes.set(key, new Attribute(value));
    }
  }
}

@ECSComponent("SightComponent")
export class SightComponent extends Component {
  constructor(
    public range: number = 80,         // In pixels
    public angle: number = 90,        // In degrees
    public direction: number = 0,     // In radians
    public seenIds: number[] = [],
  ) { super(); }
}

// Tags to identify entity types
@ECSComponent("PlayerComponent")
export class PlayerComponent extends Component {
  constructor(public isHidden: boolean = false) { super(); }
}
@ECSComponent("MonsterComponent")
export class MonsterComponent extends Component {}
@ECSComponent("BulletComponent")
export class BulletComponent extends Component {}