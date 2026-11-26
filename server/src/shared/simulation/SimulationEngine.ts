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
  PlayerComponent,
  InteractableComponent,
  DoorComponent,
  SightComponent,
  AttributeComponent,
  BulletComponent,
} from "./components.js";
import { TILE_HEIGHT, TILE_WIDTH } from "../world/MapGeometry.js";
import { GeneratedGameplayObject as GameplayObject } from "../world/generation/types/GameplayTypes.js";
import { MovementSystem } from "./systems/MovementSystem.js";
import { CollisionLayer, DEFAULT_BULLET_COLLISIONS, DEFAULT_PLAYER_COLLISIONS } from "./collisionLayers.js";

// Renamed to SimWorld to avoid clashing with ESEngine's World class
export interface SimWorld {
  id: string;
  engineWorld: ESEngineWorld; // Store the engine world so we can stop/destroy it later
  scene: Scene;
  worldMap: WorldMap;
  playerEntities: Map<string, Entity>;
  entities: Map<string, Entity>; 
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
      entities: new Map(),
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
   * Populates a world with generated gameplay objects (Chests, Doors, etc.)
   */
  public spawnGameplayObjects(
    worldId: string,
    objects: GameplayObject[],
  ): void {
    const world = this.worlds.get(worldId);
    if (!world) return;

    for (const obj of objects || []) {
      // Calculate the center pixel position of the object
      const pixelX =
        (obj.position.x + (obj.footprint?.width ?? 1) / 2) * TILE_WIDTH;
      const pixelY =
        (obj.position.y + (obj.footprint?.height ?? 1) / 2) * TILE_HEIGHT;

      const entity = this.createEntity(worldId, `${obj.kind}_${obj.id}`);
      if (!entity) continue;

      world.entities.set(obj.id.toString(), entity);
      entity.addComponent(new TransformComponent(pixelX, pixelY));

      if (obj.kind === "Door") {
        entity.addComponent(new InteractableComponent("Door", obj.id));
        entity.addComponent(
          new DoorComponent(obj.initialState === "OPEN", obj.orientation),
        );

        // If the door starts CLOSED, we must mark its tiles as solid in the physics grid
        if (obj.initialState === "CLOSED") {
          const w = obj.footprint?.width ?? 1;
          const h = obj.footprint?.height ?? 1;
          for (let dx = 0; dx < w; dx++) {
            for (let dy = 0; dy < h; dy++) {
              // world.worldMap.setSolid(obj.position.x + dx, obj.position.y + dy, true);
            }
          }
        }
      } else if (
        ["Chest", "Ritual", "Closet", "SpawnArea"].includes(obj.kind)
      ) {
        entity.addComponent(new InteractableComponent(obj.kind, obj.id));
      }
    }
  }

  /**
   * Generic method to create ANY entity in a specific world.
   */
  public createEntity(worldId: string, name: string = "Entity"): Entity {
    const world = this.worlds.get(worldId);

    return world!.scene.createEntity(name);
  }

  public createPlayerEntity(worldId: string, name: string, x: number, y: number): Entity {
    const world = this.worlds.get(worldId);
    
    const e = this.createEntity(worldId, "Player_"+name);
    e.addComponent(new TransformComponent(x, y));
    e.addComponent(new VelocityComponent(0, 0));
    e.addComponent(new ColliderComponent(2, DEFAULT_PLAYER_COLLISIONS));
    e.addComponent(new PlayerComponent());
    e.addComponent(new SightComponent(120, 360, 0));
    
    // Attributes
    e.addComponent(new AttributeComponent({
      health: 100,
      speed: 75,
      sightRange: 120,
      sightAngle: 360
    }));

    world?.playerEntities.set(name, e);

    return e;
  }

  public createBulletEntity(worldId: string, name: string = "Unnamed", x: number, y: number, vx: number, vy: number): Entity {
    const e = this.createEntity(worldId, "Bullet_"+name);
    e.addComponent(new TransformComponent(x, y));
    e.addComponent(new VelocityComponent(vx, vy));
    e.addComponent(new ColliderComponent(1, CollisionLayer.Bullet));
    e.addComponent(new BulletComponent()); // true = destroyOnWall
    e.addComponent(new AttributeComponent({ damage: 10 }));
    return e;
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

/**
 * Helper function to find the exact point before a collision occurs using Binary Search.
 */
export function resolveAxisCollision(
  worldMap: WorldMap,
  startPos: number,
  endPos: number,
  otherPos: number,
  radius: number,
  isXAxis: boolean
): number {
  const checkCollision = (pos: number) => isXAxis
    ? worldMap.checkCircleCollision(pos, otherPos, radius)
    : worldMap.checkCircleCollision(otherPos, pos, radius);

  if (!checkCollision(endPos)) return endPos;
  if (checkCollision(startPos)) return endPos; // Escape if somehow stuck

  let valid = startPos;
  let invalid = endPos;

  for (let i = 0; i < 8; i++) {
    const mid = (valid + invalid) / 2;
    if (checkCollision(mid)) {
      invalid = mid;
    } else {
      valid = mid;
    }
  }
  return valid;
}

