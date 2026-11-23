import { Component, ECSComponent } from "@esengine/ecs-framework";

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
  constructor(public radius: number = 1) {
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

// Tags to identify entity types
@ECSComponent("PlayerTag")
export class PlayerTag extends Component {}
@ECSComponent("MonsterTag")
export class MonsterTag extends Component {}
