
import type {
  CardinalDirection,
  TilePoint,
} from "./MapGeometry.js";

/**
 * Defines one doorway at a room boundary.
 */
export interface DoorwayAnchor {
  roomId: number;

  /**
   * Position of the doorway in tile coordinates.
   */
  position: TilePoint;

  /**
   * Direction from the room toward the corridor.
   */
  orientation: CardinalDirection;
}

/**
 * How the connection was created.
 */
export type RoomConnectionType =
  | "TREE"
  | "EXTRA";

/**
 * Connection between two rooms.
 */
export interface RoomConnection {
  id: number;

  fromRoomId: number;
  toRoomId: number;

  type: RoomConnectionType;

  /**
   * Centerline of the generated corridor.
   * Coordinates are expressed in tiles.
   */
  corridorPath: TilePoint[];

  /**
   * Corridor width in tiles.
   */
  width: number;

  /**
   * Each connection has exactly two doorway anchors:
   * one for each connected room.
   */
  doorways: [
    DoorwayAnchor,
    DoorwayAnchor
  ];
}
