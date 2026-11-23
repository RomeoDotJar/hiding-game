// shared/world/parseTiledObjects.ts
import { TiledMap } from "../TiledMap.js";
import { GeneratedGameplayObject } from "../generation/types/GameplayTypes.js";
import { TILE_WIDTH, TILE_HEIGHT } from "../MapGeometry.js";

export function parseTiledObjects(
  mapData: TiledMap,
): GeneratedGameplayObject[] {
  const objects: GeneratedGameplayObject[] = [];
  const objectsLayer = mapData.layers.find(
    (l) => l.type === "objectgroup" && l.name === "Objs",
  );

  if (!objectsLayer || !objectsLayer.objects) return objects;

  for (const obj of objectsLayer.objects) {
    // Convert Tiled's pixel coordinates back to tile coordinates
    const tileX = Math.floor(obj.x / TILE_WIDTH);
    const tileY = Math.floor(obj.y / TILE_HEIGHT);

    // Tiled objects might have 0 width/height if they are points
    const width = Math.max(1, Math.ceil(obj.width / TILE_WIDTH));
    const height = Math.max(1, Math.ceil(obj.height / TILE_HEIGHT));

    // Helper to read custom properties safely
    const getProp = <T>(name: string, defaultValue: T): T => {
      const prop = obj.properties?.find((p) => p.name === name);
      return (prop?.value as T) ?? defaultValue;
    };

    const base = {
      id: obj.id,
      roomId: -1, // Hub rooms don't have generated IDs, use -1
      position: { x: tileX, y: tileY },
      footprint: { x: tileX, y: tileY, width, height },
    };

    if (obj.type === "SpawnArea") {
      objects.push({
        ...base,
        kind: "SpawnArea",
        faction: getProp("faction", "PLAYER"),
        spawnIndex: getProp("spawnIndex", 0),
      });
    } else if (obj.type === "Door") {
      objects.push({
        ...base,
        kind: "Door",
        connectionId: getProp("connectionId", -1),
        orientation: getProp("orientation", "NORTH"),
        hinge: { x: tileX, y: tileY },
        initialState: getProp("initialState", "CLOSED"),
      });
    } else if (obj.type === "Chest") {
      objects.push({
        ...base,
        kind: "Chest",
        item: "CHALK",
        amount: getProp("amount", 1),
        regionRitualId: getProp("regionRitualId", -1),
      });
    } else if (obj.type === "Closet") {
      objects.push({
        ...base,
        kind: "Closet",
        orientation: getProp("orientation", "SOUTH"),
      });
    } else if (obj.type === "Ritual") {
      objects.push({
        ...base,
        kind: "Ritual",
        ritualId: getProp("ritualId", 0),
        chalkRequired: getProp("chalkRequired", 3),
      });
    }
  }

  return objects;
}
