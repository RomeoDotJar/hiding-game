
import type { TiledMap } from "../../TiledMap.js";

import type {
  GeneratedRoom,
} from "./RoomTypes.js";

import type {
  RoomConnection,
} from "./ConnectionTypes.js";

/**
 * Complete logical and visual representation
 * of a procedurally generated map.
 */
export interface ModularMap {
  /**
   * Seed used to generate the map.
   */
  seed: number;

  /**
   * Generated rooms, including geometry and metadata.
   */
  rooms: GeneratedRoom[];

  /**
   * All connections between generated rooms.
   */
  connections: RoomConnection[];

  /**
   * Final map consumed by the existing Tiled/PixiJS pipeline.
   *
   * Gameplay objects are serialized into its Objs layer.
   */
  tiledMap: TiledMap;
}
