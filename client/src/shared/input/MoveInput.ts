import { schema, t, type SchemaType } from "@colyseus/schema";

// Define the input schema (flat primitives only)
export const MoveInput = schema({
  moveX: t.int8<-1 | 0 | 1>(), // -1 = left, 1 = right
  moveY: t.int8<-1 | 0 | 1>(), // -1 = up, 1 = down
  interact: t.boolean(), // Interact action
});

export type MoveInput = SchemaType<typeof MoveInput>;
