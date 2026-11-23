import { Room, Client, CloseCode, type StepContext, Delayed } from "colyseus";
import { Player, MyRoomState, WorldInfo, GamePhase, InteractableState } from "../shared/schema/MyRoomState.js";
import { MoveInput } from "../shared/input/MoveInput.js";
import { TICK_RATE } from "../shared/constants.js";
import { WorldMap } from "../shared/world/WorldMap.js";
import { TiledMap, TiledObject } from "../shared/world/TiledMap.js";
import fs from 'fs';
import { SimulationEngine } from "../shared/simulation/SimulationEngine.js";
import { generateGameBoard } from "../shared/world/generateTest.js";
import { TransformComponent, VelocityComponent } from "../shared/simulation/components.js";
import { LoadedMapData, loadMapData } from "../shared/world/utils/load.js";

export class MyRoom extends Room<{ state: MyRoomState, input: MoveInput }> {
  private simEngine!: SimulationEngine;
  private gameBoardId: string | null = null;
  
  maxClients = 8;
  state = new MyRoomState();
  rewind = this.allowRewindState({ maxRewindMs: 500 });

  inputs = this.defineInput(MoveInput, {
    bufferMaxSize: 64
  });

  private joinCount = 0;
  private phaseTimeLeft = 0;
  private tickAccumulator = 0;

  onCreate(options: any) {
    this.state = new MyRoomState();
    this.patchRate = 16;

    // Initialize Simulation Engine
    this.simEngine = new SimulationEngine();

    // TILEMAP INIT
    let mapPath = "assets/test..tmj";
    let mapData: TiledMap = JSON.parse(fs.readFileSync(mapPath, 'utf-8'));
    this.simEngine.createWorld("Hub", new WorldMap(mapData));

    const hubInfo = new WorldInfo();
    hubInfo.type = "Hub";
    hubInfo.path = mapPath;
    this.state.worlds.set("Hub", hubInfo);

    // Attach the collection and fields to record.
    this.rewind.attachAll(this.state.players, {
      fields: ["x", "y"],
    });

    this.setFixedTimestep((ctx) => this.step(ctx), TICK_RATE);

    this.onMessage("pong_response", (client, message: { timestamp: number }) => {
      const rtt = Date.now() - message.timestamp;
      const player = this.state.players.get(client.sessionId);
      if (player) {
        player.ping = rtt;
      }
    });

    this.clock.setInterval(() => {
      this.measurePingsForAllClients();
    }, 3000);

    this.onMessage("tag_attempt", (client) => {
      const seen = this.rewind.lastSeenBy(client.sessionId);
      const me = this.state.players.get(client.sessionId);
      if (!me) return;

      let taggedSomeone = false;

      for (const [id, target] of this.state.players) {
        if (id === client.sessionId) continue;
        // Only tag players in the same world!
        if (target.worldId !== me.worldId) continue;

        const targetX = seen.value(target, "x");
        const targetY = seen.value(target, "y");

        const dx = targetX - me.x;
        const dy = targetY - me.y;
        const distance = Math.sqrt(dx * dx + dy * dy);

        if (distance < 10) {
          taggedSomeone = true;
          console.log(`Player ${client.sessionId} lag-compensated tag on ${id}!`);
          
          const nx = distance > 0 ? dx / distance : 1;
          const ny = distance > 0 ? dy / distance : 0;
          const bounceForce = 10;

          me.x -= nx * bounceForce;
          me.y -= ny * bounceForce;
          target.x += nx * bounceForce;
          target.y += ny * bounceForce;
        }
      }

      if (taggedSomeone) {
        this.broadcast("tag_success", { tagger: client.sessionId });
      }
    });

    this.setPhase(GamePhase.Intermission, 2);
  }

  private setPhase(newPhase: GamePhase, durationSeconds: number) {
    console.log(`[GameFlow] Transitioning to phase: ${newPhase} for ${durationSeconds}s`);
    this.state.phase = newPhase;
    this.state.phaseTimer = durationSeconds;
    this.phaseTimeLeft = durationSeconds;
    this.tickAccumulator = 0;

    if (newPhase === GamePhase.Playing) {
      this.startRound();
    } else if (newPhase === GamePhase.Ended) {
      this.returnToHub();
    }
  }

  measurePingsForAllClients() {
    this.clients.forEach((client) => {
      client.send("ping_request", { timestamp: Date.now() });
    })
  }

  onJoin(client: Client, options: any) {
    console.log(client.sessionId, "joined!");

    let targetWorldId = "Hub";
    let { x:spawnX, y:spawnY } = this.getSpawnPoint(targetWorldId);

    // 1. Add to Colyseus Schema
    const newPlayer = new Player({ x: spawnX, y: spawnY });
    newPlayer.worldId = targetWorldId;
    this.state.players.set(client.sessionId, newPlayer);

    // 2. Add to ECS Engine
    this.simEngine.spawnPlayer(targetWorldId, client.sessionId, spawnX, spawnY);
  }

  onLeave(client: Client, code: CloseCode) {
    console.log(client.sessionId, "left!", code);
    const player = this.state.players.get(client.sessionId);
    
    if (player) {
      // Remove from ECS Engine
      this.simEngine.removePlayer(player.worldId, client.sessionId);
      // Remove from Schema
      this.state.players.delete(client.sessionId);
    }
  }

  onDispose() {
    console.log("room", this.roomId, "disposing...");
  }

  step(ctx: StepContext) {
    this.phaseTimeLeft -= ctx.dt;
    this.tickAccumulator += ctx.dt;

    if (this.tickAccumulator >= 1.0) {
      this.tickAccumulator -= 1.0;
      this.state.phaseTimer = Math.max(0, Math.ceil(this.phaseTimeLeft));
      //console.log(this.state.phase,this.state.phaseTimer);
    }

    // Evaluate Phase Transitions
    if (this.phaseTimeLeft <= 0) {
      if (this.state.phase === GamePhase.Intermission) {
        this.setPhase(GamePhase.Playing, 60); // GameBoard lasts 60 seconds
      } else if (this.state.phase === GamePhase.Playing) {
        this.setPhase(GamePhase.Ended, 10);   // 10 seconds to show results
      } else if (this.state.phase === GamePhase.Ended) {
        this.setPhase(GamePhase.Intermission, 15); // Restart the cycle
      }
    }

    // Apply inputs to the correct world
    for (const [sessionId, player] of this.state.players) {
      const cmd = this.inputs.get(sessionId).next();
      if (cmd) {
        this.simEngine.setPlayerInput(player.worldId, sessionId, cmd.moveX, cmd.moveY);
      }
    }

    // Tick ALL worlds at once
    this.simEngine.tick(ctx.dt);

    // Sync ECS state back to Colyseus Schema
    for (const [sessionId, player] of this.state.players) {
      const world = this.simEngine.getWorld(player.worldId);
      if (!world) continue;
      
      const entity = world.playerEntities.get(sessionId);
      if (!entity) continue;

      const transform = entity.getComponent(TransformComponent);
      const vel = entity.getComponent(VelocityComponent);
      
      if (transform) {
        player.x = transform.x;
        player.y = transform.y;
      }
      if (vel) {
        player.vx = vel.vx;
        player.vy = vel.vy;
      }
    }
  }

  startRound() {
    if (this.gameBoardId) return; // Prevent multiple concurrent boards

    console.log("Generating Game Board!");
    const seed = Math.floor(Math.random() * 1000000);
    this.gameBoardId = `Game_${seed}`;

    const info = new WorldInfo();
    info.type = "GameBoard";
    info.seed = seed;
    this.state.worlds.set(this.gameBoardId, info);
    
    loadMapData(info).then((loadedMapData: LoadedMapData) => {
      const gbWorld = loadedMapData.worldMap;
      const gameplayObjects = loadedMapData.gameplayObjects;

      this.simEngine.createWorld(this.gameBoardId, gbWorld);
      this.simEngine.spawnGameplayObjects(this.gameBoardId, gameplayObjects);

      // Register interactable states in the Colyseus Schema
      for (const obj of gameplayObjects) {
        // We don't necessarily need to sync SpawnAreas to the client via Schema
        if (obj.kind !== "SpawnArea") {
          const state = new InteractableState();
          state.id = obj.id.toString();
          state.type = obj.kind;
          state.isOpen = obj.kind === "Door" ? obj.initialState === "OPEN" : false;
          state.chalkCount = 0;
          state.isLooted = false;
          
          info.interactables.set(obj.id.toString(), state);
        }
      }

      // Move all players into the new world
      for (const [sessionId, player] of this.state.players) {
        let spawnPoint = this.getSpawnPoint(this.gameBoardId);
        this.movePlayerToWorld(sessionId, player, this.gameBoardId, spawnPoint.x, spawnPoint.y);
      }
    });
  }

  returnToHub() {
    if (!this.gameBoardId) return;

    console.log("Returning everyone to the Hub!");
    const oldGameBoardId = this.gameBoardId;
    this.gameBoardId = null; // Clear it before moving players back

    // Move all players back to Hub
    for (const [sessionId, player] of this.state.players) {
      let spawnPoint = this.getSpawnPoint("Hub");
      this.movePlayerToWorld(sessionId, player, "Hub", spawnPoint.x, spawnPoint.y);
    }

    // Destroy the Game Board
    this.simEngine.removeWorld(oldGameBoardId);
    this.state.worlds.delete(oldGameBoardId);
  }

  private movePlayerToWorld(sessionId: string, player: Player, targetWorldId: string, spawnX: number, spawnY: number) {
    // 1. Remove from old world
    this.simEngine.removePlayer(player.worldId, sessionId);
    const targetWorldInfo = this.state.worlds.get(targetWorldId);
    
    // 2. Update schema
    player.worldId = targetWorldId;
    player.x = spawnX;
    player.y = spawnY;
    player.vx = 0;
    player.vy = 0;

    console.log(targetWorldInfo, targetWorldId);

    this.clients.get(sessionId)?.send("moveToWorld", { worldInfo: targetWorldInfo, worldId: targetWorldId });

    // 3. Spawn in the new world
    this.simEngine.spawnPlayer(targetWorldId, sessionId, spawnX, spawnY);
  }

  private getSpawnPoint(worldId: string): {x: number, y: number} {
    const world = this.simEngine.getWorld(worldId);
    if (!world) return { x: 500, y: 500 };

    let spawnArea = world.worldMap.findObject((val: TiledObject) => val.type == 'SpawnArea');
    
    if (spawnArea) {
      return { x: spawnArea.x + spawnArea.width / 2, y: spawnArea.y + spawnArea.height / 2 };
    } else {
      return { 
        x: (world.worldMap.mapData.width * world.worldMap.mapData.tilewidth) / 2, 
        y: (world.worldMap.mapData.height * world.worldMap.mapData.tileheight) / 2 
      };
    }
  }

  onDrop(client: Client, code: CloseCode) {
    this.allowReconnection(client, 30).catch(() => { });
  }

  onReconnect(client: Client) {
    console.log(client.sessionId, "reconnected!");
  }
}