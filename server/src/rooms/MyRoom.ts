import { Room, Client, CloseCode, type StepContext, Delayed } from "colyseus";
import { Player, MyRoomState } from "../shared/schema/MyRoomState.js";
import { applyInput, type PlayerEntity } from "../shared/input/applyInput.js";
import { MoveInput } from "../shared/input/MoveInput.js";
import { TICK_RATE } from "../shared/constants.js";
import { WorldMap } from "../shared/world/WorldMap.js";
import { TiledMap, TiledObject } from "../shared/world/TiledMap.js";
import fs from 'fs';

export class MyRoom extends Room<{ state: MyRoomState, input: MoveInput }> {
  private pingInterval!: Delayed;
  maxClients = 8;
  state = new MyRoomState();
  rewind = this.allowRewindState({ maxRewindMs: 500 });
  worlds: Map<string, WorldMap> = new Map();

  /**
   * Per-client input buffer. `sanitize` clamps every field as it is decoded —
   * never trust the wire — and the buffer holds ~2s of inputs at this tick rate
   * so a burst after a stall still replays in order.
   */
  inputs = this.defineInput(MoveInput, {
    bufferMaxSize: 64
  });

  private joinCount = 0;

  messages = {
    // movement arrives through the input buffer above — register handlers here
    // only for things that are not inputs (chat, emotes, …).
  };

  onCreate(options: any) {
    this.state = new MyRoomState();
    this.patchRate = 16;

    // TILEMAP INIT
    let mapPath = "assets/test..tmj";
    let mapData: TiledMap = JSON.parse(fs.readFileSync(mapPath, 'utf-8'));
    this.worlds.set("Hub",new WorldMap(mapData));

    // Attach the collection and fields to record.
    this.rewind.attachAll(this.state.players, {
      fields: ["x", "y"], // The fields that need to be rewound
    });

    this.setFixedTimestep((ctx) => this.step(ctx), TICK_RATE);

    this.onMessage("pong_response", (client, message: { timestamp: number }) => {
      // Calculate how many milliseconds have passed since we sent the request
      const rtt = Date.now() - message.timestamp;

      // Update the player's ping in the schema
      const player = this.state.players.get(client.sessionId);
      if (player) {
        player.ping = rtt;
      }
    });

    this.pingInterval = this.clock.setInterval(() => {
      this.measurePingsForAllClients();
    }, 3000);

    this.onMessage("tag_attempt", (client) => {
      // 1. Get the world as THIS client saw it
      const seen = this.rewind.lastSeenBy(client.sessionId);
      const me = this.state.players.get(client.sessionId);
      if (!me) return;

      let taggedSomeone = false;

      // 2. Check distance based on the REWOUND positions
      for (const [id, target] of this.state.players) {
        if (id === client.sessionId) continue;

        const targetX = seen.value(target, "x");
        const targetY = seen.value(target, "y");

        const dx = targetX - me.x;
        const dy = targetY - me.y;
        const distance = Math.sqrt(dx * dx + dy * dy);

        if (distance < 5+5) {
          taggedSomeone = true;
          console.log(`Player ${client.sessionId} lag-compensated tag on ${id}!`);
          
          // Prevent division by zero if they spawn exactly on top of each other
          const nx = distance > 0 ? dx / distance : 1;
          const ny = distance > 0 ? dy / distance : 0;

          // Teleport them away by a visible amount (e.g., 40 pixels)
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
  }

  measurePingsForAllClients() {
    this.clients.forEach((client) => {
      client.send("ping_request", { timestamp: Date.now() });
    })
  }

  onJoin(client: Client, options: any) {
    console.log(client.sessionId, "joined!");

    let hubWorld: WorldMap = this.worlds.get('Hub');

    if (hubWorld) {

      let spawnArea = hubWorld.getObj((val:TiledObject)=>{return val.type=='SpawnArea';});

      if (spawnArea) {
        
        this.state.players.set(client.sessionId, new Player({
          x: spawnArea.x+spawnArea.width/2,
          y: spawnArea.y+spawnArea.height/2,
        }));

        return;
      }
    }

    // Deterministic spawn ring, so two players never start on top of each other.
    const angle = this.joinCount++ * 2.399963;
    this.state.players.set(client.sessionId, new Player({
      x: 1000 / 2 + Math.cos(angle) * 80,
      y: 1000 / 2 + Math.sin(angle) * 80,
    }));
  }

  onLeave(client: Client, code: CloseCode) {
    console.log(client.sessionId, "left!", code);
    this.state.players.delete(client.sessionId);
  }

  onDispose() {
    console.log("room", this.roomId, "disposing...");
  }

  /**
   * One shared `stepEntity` per received input, so the set the client predicted
   * is exactly the set the server applied.
   */
  step(ctx: StepContext) {
    for (const [sessionId, player] of this.state.players) {
      const cmd = this.inputs.get(sessionId).next(); // Get the next buffered input
      if (cmd) {
        let oldX = player.x;
        let oldY = player.y;

        // Cast the Colyseus state player to our shared PlayerEntity type
        applyInput(player as unknown as PlayerEntity, cmd as any, ctx.dt);

        player.vx = (player.x - oldX) / ctx.dt;
        player.vy = (player.y - oldY) / ctx.dt;
      }
    }

    //this.handlePlayerCollisions();
    // for (const [sessionId, player] of this.state.players) {
    //   const channel = this.inputs.get(sessionId);
    //   if (!channel) { continue; }

    //   for (const input of channel) {
    //   }
    // }
  }

  private handlePlayerCollisions() {
    // Get all players as an array to compare them
    const players = Array.from(this.state.players.values());

    for (let i = 0; i < players.length; i++) {
      for (let j = i + 1; j < players.length; j++) {
        const p1 = players[i];
        const p2 = players[j];

        const dx = p2.x - p1.x;
        const dy = p2.y - p1.y;
        const distance = Math.sqrt(dx * dx + dy * dy);

        // 10 pixel radius each means they collide if distance < 20
        const minDistance = 2;

        if (distance < minDistance) {
          // Prevent division by zero if they spawn exactly on top of each other
          const nx = distance > 0 ? dx / distance : 1;
          const ny = distance > 0 ? dy / distance : 0;

          // Teleport them away by a visible amount (e.g., 40 pixels)
          const bounceForce = 4;

          p1.x -= nx * bounceForce;
          p1.y -= ny * bounceForce;

          p2.x += nx * bounceForce;
          p2.y += ny * bounceForce;
        }
      }
    }
  }

  /**
   * Called on any disconnection the client did not ask for — a network blip, a
   * suspended tab, a tunnel change. Holding the seat lets the SDK retry into the
   * same session, so the player keeps their entity and their place in the room.
   */
  onDrop(client: Client, code: CloseCode) {
    // Deliberately not awaited: the framework routes the outcome to onReconnect()
    // or onLeave() by itself. The catch is only here because the promise also
    // rejects when the room is already disposing (server shutdown), which would
    // otherwise surface as an unhandled rejection.
    this.allowReconnection(client, 30).catch(() => { });
  }

  onReconnect(client: Client) {
    console.log(client.sessionId, "reconnected!");
  }
}
