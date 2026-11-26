import type {
  MapGenerationConfig,
  MapGenerationConfigInput,
} from "./MapGenerationConfig.js";

import { DEFAULT_ROOM_ROSTER } from "./DefaultRoomRoster.js";

/**
 * Default settings for room-based map generation.
 */
export const DEFAULT_MAP_GENERATION_CONFIG: MapGenerationConfig = {
  width: 60,
  height: 60,

  roomsCount: 12,
  playerCount: 1,

  roomRoster: DEFAULT_ROOM_ROSTER,

  connectivity: {
    extraConnectionChance: 0.125,
    deadEndChance: 0.5,
    maxDeadEnds: 2,

    corridorWidth: 4,
    minRoomSpacing: 2,
    minDoorwaySeparation: 1,
  },

  objectives: {
    ritualRoomCount: 3,
    chalkPerRitual: 3,
    extraChalkChests: 0,
  },

  interactables: {
    doors: {
      initialState: "CLOSED",
    },

    closets: {
      coverageRadius: 1,
      additionalPerPlayer: 0.25,
    },
  },

  spawns: {
    playerSpawnRoomCapacity: 2,
    monsterSpawnRoomCount: 1,
    minMonsterPlayerSpawnDistance: 1,
  },

  walls: {
    minWallThickness: 1,
    maxWallThickness: 2,
  },

  decorate: false,
};

/**
 * Resolves optional user settings into a complete
 * configuration.
 */
export function createMapGenerationConfig(
  input: MapGenerationConfigInput = {},
): MapGenerationConfig {
  const defaults = DEFAULT_MAP_GENERATION_CONFIG;

  const config: MapGenerationConfig = {
    width: input.width ?? defaults.width,
    height: input.height ?? defaults.height,

    roomsCount: input.roomsCount ?? defaults.roomsCount,
    playerCount: input.playerCount ?? defaults.playerCount,

    roomRoster: input.roomRoster ?? defaults.roomRoster,

    connectivity: {
      ...defaults.connectivity,
      ...input.connectivity,
    },

    objectives: {
      ...defaults.objectives,
      ...input.objectives,
    },

    interactables: {
      doors: {
        ...defaults.interactables.doors,
        ...input.interactables?.doors,
      },

      closets: {
        ...defaults.interactables.closets,
        ...input.interactables?.closets,
      },
    },

    spawns: {
      ...defaults.spawns,
      ...input.spawns,
    },

    walls: {
      ...defaults.walls,
      ...input.walls,
    },

    decorate: input.decorate ?? defaults.decorate,
  };

  validateMapGenerationConfig(config);

  return config;
}

/**
 * Validates the resolved configuration before generation.
 */
export function validateMapGenerationConfig(config: MapGenerationConfig): void {
  const assertInteger = (
    value: number,
    name: string,
    minimum: number,
  ): void => {
    if (!Number.isInteger(value) || value < minimum) {
      throw new Error(`${name} must be an integer >= ${minimum}.`);
    }
  };

  const assertProbability = (value: number, name: string): void => {
    if (!Number.isFinite(value) || value < 0 || value > 1) {
      throw new Error(`${name} must be between 0 and 1.`);
    }
  };

  assertInteger(config.width, "width", 1);
  assertInteger(config.height, "height", 1);

  assertInteger(config.roomsCount, "roomsCount", 1);
  assertInteger(config.playerCount, "playerCount", 1);

  assertProbability(
    config.connectivity.extraConnectionChance,
    "extraConnectionChance",
  );

  assertProbability(config.connectivity.deadEndChance, "deadEndChance");

  assertInteger(config.connectivity.maxDeadEnds, "maxDeadEnds", 0);

  assertInteger(config.connectivity.corridorWidth, "corridorWidth", 1);

  assertInteger(config.connectivity.minRoomSpacing, "minRoomSpacing", 0);

  assertInteger(config.objectives.chalkPerRitual, "chalkPerRitual", 1);

  assertInteger(config.objectives.extraChalkChests, "extraChalkChests", 0);

  assertInteger(
    config.interactables.closets.coverageRadius,
    "closet coverageRadius",
    0,
  );

  if (
    !Number.isFinite(config.interactables.closets.additionalPerPlayer) ||
    config.interactables.closets.additionalPerPlayer < 0
  ) {
    throw new Error("additionalPerPlayer must be a non-negative number.");
  }

  assertInteger(
    config.spawns.playerSpawnRoomCapacity,
    "playerSpawnRoomCapacity",
    1,
  );

  assertInteger(
    config.spawns.monsterSpawnRoomCount,
    "monsterSpawnRoomCount",
    1,
  );

  assertInteger(
    config.spawns.minMonsterPlayerSpawnDistance,
    "minMonsterPlayerSpawnDistance",
    0,
  );

  assertInteger(config.walls.minWallThickness, "minWallThickness", 1);

  assertInteger(
    config.walls.maxWallThickness,
    "maxWallThickness",
    config.walls.minWallThickness,
  );

  if (config.roomRoster.length === 0) {
    throw new Error("RoomRoster cannot be empty.");
  }

  const roomIds = new Set<string>();

  let totalWeight = 0;

  const requiredCapabilities = [
    "RITUAL_ELIGIBLE",
    "CHEST_ELIGIBLE",
    "CLOSET_ELIGIBLE",
    "PLAYER_SPAWN_ELIGIBLE",
    "MONSTER_SPAWN_ELIGIBLE",
  ] as const;

  const availableCapabilities = new Set(
    config.roomRoster.flatMap((entry) => entry.Capabilities),
  );

  for (const capability of requiredCapabilities) {
    if (!availableCapabilities.has(capability)) {
      throw new Error(`RoomRoster has no room with capability ${capability}.`);
    }
  }

  for (const entry of config.roomRoster) {
    if (!entry.Room.trim()) {
      throw new Error("Room identifiers cannot be empty.");
    }

    if (roomIds.has(entry.Room)) {
      throw new Error(`Duplicate room identifier: ${entry.Room}`);
    }

    roomIds.add(entry.Room);

    if (!Number.isFinite(entry.Weight) || entry.Weight <= 0) {
      throw new Error(`Invalid weight for room ${entry.Room}.`);
    }

    totalWeight += entry.Weight;

    const rules = entry.Generation;

    assertInteger(rules.minWidth, `${entry.Room}.minWidth`, 1);
    assertInteger(rules.maxWidth, `${entry.Room}.maxWidth`, rules.minWidth);

    assertInteger(rules.minHeight, `${entry.Room}.minHeight`, 1);
    assertInteger(rules.maxHeight, `${entry.Room}.maxHeight`, rules.minHeight);

    if (rules.shape === "L_SHAPED") {
      assertInteger(
        rules.minArmThickness ?? 0,
        `${entry.Room}.minArmThickness`,
        1,
      );

      assertInteger(
        rules.maxArmThickness ?? 0,
        `${entry.Room}.maxArmThickness`,
        rules.minArmThickness ?? 1,
      );
    }
  }

  if (!Number.isFinite(totalWeight) || totalWeight <= 0) {
    throw new Error("RoomRoster must have a positive total weight.");
  }

  if (typeof config.decorate !== "boolean") {
    throw new Error("decorate must be a boolean.");
  }

  if (
    config.interactables.doors.initialState !== "OPEN" &&
    config.interactables.doors.initialState !== "CLOSED"
  ) {
    throw new Error("Invalid initial door state.");
  }

  const requiredPlayerRooms = Math.ceil(
    config.playerCount / config.spawns.playerSpawnRoomCapacity,
  );

  const minimumRoomCount =
    config.objectives.ritualRoomCount +
    requiredPlayerRooms +
    config.spawns.monsterSpawnRoomCount;

  if (config.roomsCount < minimumRoomCount) {
    throw new Error(
      `roomsCount must be at least ${minimumRoomCount} ` +
        "to reserve separate Ritual and spawn rooms.",
    );
  }
}
