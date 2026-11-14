import { schema, t } from "@colyseus/schema";
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
export const Player = schema({
    x: t.number(),
    y: t.number(),
    vx: t.number(),
    vy: t.number(),
});
export const MyRoomState = schema({
    players: t.map(Player),
});
