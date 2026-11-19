import { Component } from '@esengine/ecs-framework';

export class TransformComponent extends Component {
  constructor(public x: number = 0, public y: number = 0) {
    super();
  }
}

export class VelocityComponent extends Component {
  constructor(public vx: number = 0, public vy: number = 0) {
    super();
  }
}

export class ColliderComponent extends Component {
  constructor(public radius: number = 1) {
    super();
  }
}

// Tags to identify entity types
export class PlayerTag extends Component {}
export class MonsterTag extends Component {}