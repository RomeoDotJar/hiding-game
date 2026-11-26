import { PRNG } from "../../../PRNG.js";
import { RoomGenerator } from "../RoomGenerator.js";
import { MapGenerationConfig } from "../config/MapGenerationConfig.js";
import { GeneratedRoom } from "../types/RoomTypes.js";

export function generateRoomsDynamicSize(
  baseConfig: MapGenerationConfig,
  seed: number,
): { rooms: GeneratedRoom[]; dynamicConfig: MapGenerationConfig } {
  // 1. Start with a tiny map to force rooms to pack tightly.
  let testWidth = 30;
  let testHeight = 30;
  let rooms: GeneratedRoom[] = [];
  let success = false;

  // 2. Keep expanding until all required rooms fit
  while (!success) {
    const testConfig = { ...baseConfig, width: testWidth, height: testHeight };
    // Use a fresh PRNG so the room types/dimensions remain deterministic across attempts
    const rng = new PRNG(seed);

    try {
      rooms = new RoomGenerator(testConfig, rng).generate();
      success = true;
    } catch {
      // Expansion step: grow by ~1.5x and try again
      testWidth = Math.floor(testWidth * 1.5);
      testHeight = Math.floor(testHeight * 1.5);

      // Safety limit to prevent infinite loops
      if (testWidth > 200 || testHeight > 200) {
        throw new Error(
          "Map Generation failed: Could not fit all rooms even on a 200x200 map.",
        );
      }
    }
  }

  // 3. Calculate the exact bounding box of the generated rooms
  let minX = Infinity,
    minY = Infinity;
  let maxX = -Infinity,
    maxY = -Infinity;

  for (const room of rooms) {
    for (const p of room.footprint) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
  }

  // 4. Calculate the shift needed to move rooms to (margin, margin)
  const margin = 1; // Leave 1 tile for the outer boundary walls
  const shiftX = margin - minX;
  const shiftY = margin - minY;

  const finalWidth = maxX - minX + 1 + margin * 2;
  const finalHeight = maxY - minY + 1 + margin * 2;

  // 5. Shift the rooms to their new coordinates
  for (const room of rooms) {
    room.bounds.x += shiftX;
    room.bounds.y += shiftY;
    for (const p of room.footprint) {
      p.x += shiftX;
      p.y += shiftY;
    }
  }

  // 6. Return the tightly cropped config and rooms
  const dynamicConfig: MapGenerationConfig = {
    ...baseConfig,
    width: finalWidth,
    height: finalHeight,
  };

  return { rooms, dynamicConfig };
}
