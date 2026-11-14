import { schema, Schema, t, type, type SchemaType } from "@colyseus/schema";

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
  
  @type("boolean") isInteracting: boolean = false;
  
  @type("string") name: string = "Unknown";
}

export const MyRoomState = schema({
  players: t.map(Player),
});
export type MyRoomState = SchemaType<typeof MyRoomState>;
