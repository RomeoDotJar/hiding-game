import { Core, Scene, Entity, Component, EntitySystem, Matcher, Time } from '@esengine/ecs-framework';
import { Application, Sprite } from 'pixi.js';

// 1. Define a component for Pixi sprite linkage
class PixiSprite extends Component {
  constructor(public sprite: Sprite) { super(); }
}

// 2. Define a simple movement system (your AI systems will live alongside this)
class SyncSystem extends EntitySystem {
  constructor() { super(Matcher.all(PixiSprite)); }
  protected process(entities: readonly Entity[]): void {
    for (const entity of entities) {
      const { sprite } = entity.getComponent(PixiSprite)!;
      // Example: position is stored elsewhere; here we just sync
      // sprite.x = position.x; sprite.y = position.y;
    }
  }
}

export function initECS(app: Application) {
  Core.create();
  const scene = new Scene();
  scene.addSystem(new SyncSystem());
  Core.setScene(scene);

  // Run ESEngine update on Pixi's ticker
  app.ticker.add(() => {
    Core.update(performance.now() / 1000);
  });
}