import type { RoomRoster, RoomType } from "../types/RoomTypes.js";

/**
 * General connectivity settings.
 */
export interface ConnectivityConfig {
  /**
   * Probability of adding an eligible additional connection.
   * Range: 0-1.
   */
  extraConnectionChance: number;

  /**
   * Probability that an eligible leaf room
   * is preserved as a dead end.
   * Range: 0-1.
   */
  deadEndChance: number;

  corridorWidth: number;

  /**
   * Minimum spacing between room footprints, in tiles.
   */
  minRoomSpacing: number;

  minDoorwaySeparation: number;
}

/**
 * Objective-generation settings.
 */
export interface ObjectiveConfig {
  /**
   * Exactly three Ritual rooms are currently required.
   */
  ritualRoomCount: 3;

  /**
   * Required chalk pieces for each Ritual.
   */
  chalkPerRitual: number;

  /**
   * Additional optional chalk chests.
   */
  extraChalkChests: number;
}

/**
 * Door and closet settings.
 */
export interface InteractableConfig {
  doors: {
    initialState: "OPEN" | "CLOSED";
  };

  closets: {
    /**
     * Maximum graph distance from a room to
     * a room containing a closet.
     *
     * 1 means the same room or an adjacent room.
     */
    coverageRadius: number;

    /**
     * Additional closet scaling per player.
     *
     * 0.25 means 25% additional closets
     * per additional player, relative to base count.
     */
    additionalPerPlayer: number;
  };
}

/**
 * Player and monster spawning settings.
 */
export interface SpawnConfig {
  /**
   * Number of player spawn positions per room.
   */
  playerSpawnRoomCapacity: number;

  /**
   * Number of monster spawn rooms.
   */
  monsterSpawnRoomCount: number;

  /**
   * Minimum shortest-path graph distance
   * between monster and player spawn rooms.
   */
  minMonsterPlayerSpawnDistance: number;
}

/**
 * Structural wall settings.
 */
export interface WallConfig {
  minWallThickness: number;
  maxWallThickness: number;
}

export interface TileSetReference {
  firstGid: number;
  source: string;
}

export interface RoomTileSetProfile {
  roomType: RoomType;

  floor: {
    baseGid: number;
    variants: number[];
  };

  wall: {
    baseGid: number;
    // Набор тайлов для AutoMapping или собственного autotiler
    ruleSet: string;
  };

  ceiling?: {
    baseGid: number;
    opacity: number;
  };

  decoration?: {
    tileGids: number[];
    density: number;
  };
}

export interface TileSetConfig {
  tilesets: TileSetReference[];
  defaultProfile: RoomTileSetProfile;
  roomProfiles: Partial<Record<RoomType, RoomTileSetProfile>>;
}

/**
 * Fully resolved generation configuration.
 *
 * All properties are required after defaults
 * have been applied.
 */
export interface MapGenerationConfig {
  width: number;
  height: number;

  roomsCount: number;
  playerCount: 1 | 2 | 3 | 4;

  roomRoster: RoomRoster;

  connectivity: ConnectivityConfig;
  objectives: ObjectiveConfig;
  interactables: InteractableConfig;
  spawns: SpawnConfig;
  walls: WallConfig;

  decorate: boolean;
}

/**
 * Configuration accepted by the external generator.
 *
 * All fields are optional because defaults
 * will be applied before generation.
 */
export interface MapGenerationConfigInput {
  width?: number;
  height?: number;

  roomsCount?: number;
  playerCount?: 1 | 2 | 3 | 4;

  roomRoster?: RoomRoster;

  connectivity?: Partial<ConnectivityConfig>;
  objectives?: Partial<ObjectiveConfig>;
  interactables?: {
    doors?: Partial<InteractableConfig["doors"]>;
    closets?: Partial<InteractableConfig["closets"]>;
  };

  spawns?: Partial<SpawnConfig>;
  walls?: Partial<WallConfig>;

  decorate?: boolean;
}
