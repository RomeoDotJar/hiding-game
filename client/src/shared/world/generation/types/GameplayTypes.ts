import type { CardinalDirection, TilePoint, TileRect } from "./MapGeometry.js";
import { GeneratedRoom } from "./RoomTypes.js";

/**
 * These values will be serialized into Tiled's
 * Object.type property.
 *
 * Existing Hub convention "SpawnArea" is preserved.
 */
export const TILED_OBJECT_TYPES = {
  SpawnArea: "SpawnArea",
  Door: "Door",
  Chest: "Chest",
  Closet: "Closet",
  Ritual: "Ritual",
} as const;

export type GameplayObjectType =
  (typeof TILED_OBJECT_TYPES)[keyof typeof TILED_OBJECT_TYPES];

/**
 * Common properties shared by generated objects.
 */
export interface GeneratedObjectBase {
  id: number;
  roomId: number;

  /**
   * Tile-coordinate anchor.
   * For objects with a footprint, this is the footprint's top-left tile.
   * For SpawnArea point markers, this is the marker tile; TilemapAssembler
   * should serialize its pixel position at the tile center.
   */
  position: TilePoint;

  /**
   * Optional occupied footprint in tile coordinates.
   */
  footprint?: TileRect;
}

/**
 * Door placement.
 */
export interface GeneratedDoor extends GeneratedObjectBase {
  kind: "Door";

  connectionId: number;

  orientation: CardinalDirection;
  hinge: TilePoint;

  initialState: "OPEN" | "CLOSED";
}

/**
 * Chalk chest placement.
 */
export interface GeneratedChalkChest extends GeneratedObjectBase {
  kind: "Chest";

  item: "CHALK";
  amount: number;

  regionRitualId: number;
}

/**
 * Closet placement.
 */
export interface GeneratedCloset extends GeneratedObjectBase {
  kind: "Closet";
}

/**
 * Ritual altar placement.
 */
export interface GeneratedRitual extends GeneratedObjectBase {
  kind: "Ritual";

  ritualId: number;
  chalkRequired: number;
}

/**
 * One generated spawn marker.
 */
export interface GeneratedSpawnArea extends GeneratedObjectBase {
  kind: "SpawnArea";

  faction: "PLAYER" | "MONSTER";

  spawnIndex: number;
}

/**
 * Discriminated union of all generated gameplay objects.
 */
export type GeneratedGameplayObject =
  | GeneratedDoor
  | GeneratedChalkChest
  | GeneratedCloset
  | GeneratedRitual
  | GeneratedSpawnArea;

/**
 * Internal output of GameplayPlacementGenerator.
 *
 * These placements will eventually be serialized
 * into Tiled's Objs Object Layer.
 */
export interface GameplayPlacementResult {
  /** Copies of the input rooms with selected specialRoles assigned. */
  rooms: GeneratedRoom[];

  /** Typed tile-coordinate placements, later serialized into Tiled Objs. */
  objects: GeneratedGameplayObject[];
}
