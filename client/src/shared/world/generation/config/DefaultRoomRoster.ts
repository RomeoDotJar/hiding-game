import type { RoomRoster } from "../types/RoomTypes.js";

export const DEFAULT_ROOM_ROSTER: RoomRoster = [
  {
    Room: "Bedroom",
    Weight: 35,
    Type: "DEFAULT",

    Generation: {
      shape: "RECTANGLE",
      minWidth: 8,
      maxWidth: 12,
      minHeight: 7,
      maxHeight: 11,
    },

    Capabilities: [
      "CHEST_ELIGIBLE",
      "CLOSET_ELIGIBLE",
      "PLAYER_SPAWN_ELIGIBLE",
      "MONSTER_SPAWN_ELIGIBLE",
    ],
  },

  {
    Room: "Hallway",
    Weight: 20,
    Type: "NARROW",

    Generation: {
      shape: "RECTANGLE",
      minWidth: 12,
      maxWidth: 20,
      minHeight: 4,
      maxHeight: 5,
      orientation: "ANY",
    },

    Capabilities: ["CHEST_ELIGIBLE", "CLOSET_ELIGIBLE"],
  },

  {
    Room: "LargeHall",
    Weight: 15,
    Type: "LARGE",

    Generation: {
      shape: "RECTANGLE",
      minWidth: 14,
      maxWidth: 20,
      minHeight: 10,
      maxHeight: 16,
    },

    Capabilities: [
      "CHEST_ELIGIBLE",
      "CLOSET_ELIGIBLE",
      "PLAYER_SPAWN_ELIGIBLE",
      "MONSTER_SPAWN_ELIGIBLE",
    ],
  },

  {
    Room: "CornerRoom",
    Weight: 15,
    Type: "DEFAULT",

    Generation: {
      shape: "L_SHAPED",
      minWidth: 10,
      maxWidth: 16,
      minHeight: 10,
      maxHeight: 16,
      minArmThickness: 3,
      maxArmThickness: 5,
    },

    Capabilities: [
      "CHEST_ELIGIBLE",
      "CLOSET_ELIGIBLE",
      "PLAYER_SPAWN_ELIGIBLE",
      "MONSTER_SPAWN_ELIGIBLE",
    ],
  },

  {
    Room: "RitualChamber",
    Weight: 15,
    Type: "LARGE",

    Generation: {
      shape: "RECTANGLE",
      minWidth: 12,
      maxWidth: 16,
      minHeight: 12,
      maxHeight: 16,
    },

    Capabilities: ["RITUAL_ELIGIBLE"],

    ReservedOnly: true,
  },
];
