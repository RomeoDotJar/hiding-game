import { schema, t } from "@colyseus/schema";
// Define the input schema (flat primitives only)
export const MoveInput = schema({
    moveX: t.int8(), // -1 = left, 1 = right
    moveY: t.int8(), // -1 = up, 1 = down
    interact: t.boolean(), // Interact action
});
