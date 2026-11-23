import {
  Core,
  WorldManager,
  World as ESEngineWorld,
  Scene,
  Entity,
} from "@esengine/ecs-framework";
import { WorldMap } from "../world/WorldMap.js";
import {
  TransformComponent,
  VelocityComponent,
  ColliderComponent,
  PlayerTag,
} from "./components.js";
import { MovementSystem } from "./systems.js";

// Renamed to SimWorld to avoid clashing with ESEngine's World class
export interface SimWorld {
  id: string;
  engineWorld: ESEngineWorld; // Store the engine world so we can stop/destroy it later
  scene: Scene;
  worldMap: WorldMap;
  playerEntities: Map<string, Entity>;
  movementSystem: MovementSystem;
}

export class SimulationEngine {
  private worlds: Map<string, SimWorld> = new Map();
  private worldManager: WorldManager;

  constructor() {
    // 1. Initialize Core once (required for global services)
    Core.create();

    // 2. Initialize the WorldManager for multi-world isolation
    this.worldManager = new WorldManager();
  }

  public createWorld(worldId: string, worldMap: WorldMap): SimWorld {
    // 3. Create an isolated World in the manager
    const engineWorld = this.worldManager.createWorld(worldId);

    const scene = new Scene();
    const movementSystem = new MovementSystem(worldMap);
    scene.addSystem(movementSystem);

    // 4. Register the scene with the engine World
    engineWorld.createScene("main", scene);

    engineWorld.setSceneActive("main", true);

    // 5. Start the World so its systems begin updating automatically
    engineWorld.start();

    const simWorld: SimWorld = {
      id: worldId,
      engineWorld,
      scene,
      worldMap,
      playerEntities: new Map(),
      movementSystem,
    };

    this.worlds.set(worldId, simWorld);
    return simWorld;
  }

  public removeWorld(worldId: string) {
    const simWorld = this.worlds.get(worldId);
    if (simWorld) {
      // Cleanly shut down the engine world to free memory and stop updates
      simWorld.engineWorld.stop();
      simWorld.engineWorld.destroy();
      this.worlds.delete(worldId);
      this.worldManager.removeWorld(worldId);
    }
  }

  public getWorld(worldId: string): SimWorld | undefined {
    return this.worlds.get(worldId);
  }

  /**
   * Generic method to create ANY entity in a specific world.
   */
  public createEntity(worldId: string, name: string = "Entity"): Entity | null {
    const world = this.worlds.get(worldId);
    if (!world) {
      console.warn(`Cannot create entity: World '${worldId}' not found.`);
      return null;
    }

    return world.scene.createEntity(name);
  }

  /**
   * Generic method to destroy ANY entity in a specific world.
   */
  public destroyEntity(worldId: string, entity: Entity) {
    const world = this.worlds.get(worldId);
    if (!world) return;

    // Kept your local fix: only destroyEntities exists
    world.scene.destroyEntities([entity]);
  }

  /**
   * Generic method to destroy ANY entities in a specific world.
   */
  public destroyEntities(worldId: string, entities: Array<Entity>) {
    const world = this.worlds.get(worldId);
    if (!world) return;

    world.scene.destroyEntities(entities);
  }

  /**
   * Refactored player spawn using the generic createEntity method.
   */
  public spawnPlayer(
    worldId: string,
    sessionId: string,
    x: number,
    y: number,
  ): Entity | null {
    const entity = this.createEntity(worldId, `Player_${sessionId}`);
    if (!entity) return null;

    entity.addComponent(new TransformComponent(x, y));
    entity.addComponent(new VelocityComponent(0, 0));
    entity.addComponent(new ColliderComponent(2));
    entity.addComponent(new PlayerTag());

    const world = this.worlds.get(worldId)!;
    world.playerEntities.set(sessionId, entity);

    return entity;
  }

  public removePlayer(worldId: string, sessionId: string) {
    const world = this.worlds.get(worldId);
    if (!world) return;

    const entity = world.playerEntities.get(sessionId);
    if (entity) {
      this.destroyEntity(worldId, entity);
      world.playerEntities.delete(sessionId);
    }
  }

  public setPlayerInput(
    worldId: string,
    sessionId: string,
    moveX: number,
    moveY: number,
    speed = 75,
  ) {
    const world = this.worlds.get(worldId);
    if (!world) return;
    const entity = world.playerEntities.get(sessionId);
    if (!entity) return;
    const vel = entity.getComponent(VelocityComponent);
    if (vel) {
      vel.vx = moveX * speed;
      vel.vy = moveY * speed;
    }
  }

  public tick(dt: number) {
    // 6. Pass deltaTime to custom systems that need it
    for (const world of this.worlds.values()) {
      world.movementSystem.setDeltaTime(dt);
    }

    // 7. Update the WorldManager instead of Core.setScene/Core.update
    // This updates all active worlds and their scenes in isolation.
    this.worldManager.updateAll();
  }
}
