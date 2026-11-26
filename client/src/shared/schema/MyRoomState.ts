import { MapSchema, Schema, type } from "@colyseus/schema";
import type { LoadedMapData } from "../world/utils/load";

/**
 * One input frame, consumed by `Room.defineInput()`. Flat primitives only, and
 * deliberately minimal:
 *   - no `seq`  — the engine's input counter is the sequence
 *   - no `dt`   — fixed timestep: one input advances exactly one step
 *   - no time   — the SDK stamps lag-comp timing on the wire envelope
 *
 * `int8<-1 | 0 | 1>` narrows the type for your code; the room's `sanitize`
 * clamp is what actually enforces it against a modified client.
 */
export class Player extends Schema {
  @type("number") x!: number;
  @type("number") y!: number;
  @type("number") vx: number = 0;
  @type("number") vy: number = 0;

  @type("number") ping: number = 100;

  @type("string") name: string = "Unknown";

  @type("string") worldId: string = "Hub";

  @type("boolean") isInteracting: boolean = false;
  @type("boolean") isHidden: boolean = false;
}

// INTERACTABLES
export class InteractableState extends Schema {
  @type("string") id: string = "";
  @type("string") type: "Door" | "Chest" | "Ritual" | "Closet" = "Chest";
}

export class DoorState extends InteractableState {
  type = "Door" as const;
  @type("boolean") isOpen: boolean = false;
}

export class ChestState extends InteractableState {
  type = "Chest" as const;
  @type("boolean") isLooted: boolean = false;
}

export class RitualState extends InteractableState {
  type = "Ritual" as const;
  @type("number") chalkCount: number = 0;
}

export class ClosetState extends InteractableState {
  type = "Closet" as const;
  @type("boolean") isOccupied: boolean = false;
}

// WORLD
export class WorldInfo extends Schema {
  @type("string") type: string = "Hub"; // "Hub" | "GameBoard"
  @type("string") path: string = ""; // For static GameBoards
  mapData: LoadedMapData = {}; // For static GameBoards
  @type("number") seed: number = 0; // For procedural GameBoards
  @type("number") width: number = 30;
  @type("number") height: number = 30;

  @type({ map: InteractableState }) interactables =
    new MapSchema<InteractableState>();
}

// GENERAL
export class MyRoomState extends Schema {
  @type({ map: Player }) players = new MapSchema<Player>();
  @type({ map: WorldInfo }) worlds = new MapSchema<WorldInfo>();

  @type("string") phase: GamePhase = GamePhase.Intermission;
  @type("number") phaseTimer: number = 0;
}

// GAME
export enum GamePhase {
  Intermission = "intermission",
  Starting = "starting",
  Playing = "playing",
  Ended = "ended",
}
