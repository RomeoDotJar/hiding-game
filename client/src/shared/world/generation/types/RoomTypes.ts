import type { TilePoint, TileRect } from "./MapGeometry.js";

/**
 * General gameplay category.
 *
 * This is independent of the room's physical shape.
 */
export type RoomType = "DEFAULT" | "NARROW" | "LARGE";

/**
 * Physical geometry of a room.
 */
export type RoomShape = "RECTANGLE" | "L_SHAPED";

/**
 * Capabilities determine which gameplay placements
 * are allowed inside a room.
 *
 * These describe eligibility, not actual assignments.
 */
export type RoomCapability =
  | "RITUAL_ELIGIBLE"
  | "CHEST_ELIGIBLE"
  | "CLOSET_ELIGIBLE"
  | "PLAYER_SPAWN_ELIGIBLE"
  | "MONSTER_SPAWN_ELIGIBLE";

/**
 * Special roles assigned to generated rooms.
 *
 * These are different from capabilities:
 * a room can be eligible for a ritual without
 * actually being selected as one.
 */
export type RoomSpecialRole = "RITUAL" | "PLAYER_SPAWN" | "MONSTER_SPAWN";

/**
 * Individual room generation rules.
 */
export interface RoomGenerationRules {
  shape: RoomShape;

  minWidth: number;
  maxWidth: number;

  minHeight: number;
  maxHeight: number;

  /**
   * Relevant to L-shaped room generation.
   * Defines the thickness of the room's arms.
   */
  minArmThickness?: number;
  maxArmThickness?: number;

  /**
   * Preferred orientation for elongated rooms.
   */
  orientation?: "ANY" | "HORIZONTAL" | "VERTICAL";
}

/**
 * One selectable room variant.
 *
 * Room is a unique template identifier.
 * Weight determines relative selection probability.
 * Type represents broad gameplay characteristics.
 */
export interface RoomRosterEntry {
  Room: string;
  Weight: number;
  Type: RoomType;

  Generation: RoomGenerationRules;

  Capabilities: RoomCapability[];

  ReservedOnly?: boolean;
}

export type RoomRoster = readonly RoomRosterEntry[];

/**
 * A room after its actual position and geometry
 * have been generated.
 */
export interface GeneratedRoom {
  id: number;

  /**
   * Identifier of the selected RoomRosterEntry.
   */
  templateId: string;

  type: RoomType;
  shape: RoomShape;

  /**
   * Bounding rectangle.
   */
  bounds: TileRect;

  /**
   * Actual occupied tiles.
   *
   * Important for L-shaped rooms, where some
   * tiles inside bounds may not belong to the room.
   */
  footprint: TilePoint[];

  capabilities: RoomCapability[];

  specialRoles: RoomSpecialRole[];
}
