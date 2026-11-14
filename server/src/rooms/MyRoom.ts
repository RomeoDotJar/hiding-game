import { Room, Client, CloseCode, type StepContext } from "colyseus";
import { Player, MyRoomState } from "../shared/schema/MyRoomState.js";
import { applyInput, type PlayerEntity } from "../shared/input/applyInput.js";
import { MoveInput } from "../shared/input/MoveInput.js";
import { TICK_RATE } from "../shared/constants.js";

export class MyRoom extends Room<{ state: MyRoomState, input: MoveInput }> {
  maxClients = 8;
  state = new MyRoomState();

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
    this.setFixedTimestep((ctx) => this.step(ctx), TICK_RATE);
  }

  onJoin(client: Client, options: any) {
    console.log(client.sessionId, "joined!");

    // Deterministic spawn ring, so two players never start on top of each other.
    const angle = this.joinCount++ * 2.399963;
    this.state.players.set(client.sessionId, new Player({
      x: 1000 / 2 + Math.cos(angle) * 80,
      y: 1000 / 2 + Math.sin(angle) * 80,
      vx: 0,
      vy: 0,
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
        // Cast the Colyseus state player to our shared PlayerEntity type
        applyInput(player as unknown as PlayerEntity, cmd as any, ctx.dt);
      }
    }
    // for (const [sessionId, player] of this.state.players) {
    //   const channel = this.inputs.get(sessionId);
    //   if (!channel) { continue; }

    //   for (const input of channel) {
    //   }
    // }
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
    this.allowReconnection(client, 30).catch(() => {});
  }

  onReconnect(client: Client) {
    console.log(client.sessionId, "reconnected!");
  }
}
