
import type { TiledMap, TiledLayer } from "../TiledMap.js";

/**
 * Eight-direction connectivity bit flags.
 *
 * Cardinal:
 * N  = 0000 0001
 * E  = 0000 0010
 * S  = 0000 0100
 * W  = 0000 1000
 *
 * Diagonal:
 * NE = 0001 0000
 * SE = 0010 0000
 * SW = 0100 0000
 * NW = 1000 0000
 */
const N = 1;
const E = 2;
const S = 4;
const W = 8;

const NE = 16;
const SE = 32;
const SW = 64;
const NW = 128;

const ALL_DIRECTIONS = 0xff;

/**
 * Tiled global tile ID transformation flags.
 *
 * Only horizontal flipping is currently required by the supplied mappings.
 */
const FLIP_H = 0x80000000;

/**
 * Creates a Tiled GID with optional transformation flags.
 *
 * The unsigned conversion is important because JavaScript bitwise
 * operations otherwise produce signed 32-bit integers.
 */
function tile(gid: number, flags = 0): number {
  return (gid | flags) >>> 0;
}

/**
 * Base wall-outline tile.
 *
 * GID 7 = "+" in the supplied tileset.
 */
const BASE_WALL_GID = 7;

/**
 * No-connection tile and fallback.
 *
 * GID 14 has been retired.
 */
const FALLBACK_WALL_GID = 45;

/**
 * A rule describes a wall tile using required and rejected neighbors.
 *
 * Required:
 *   Every listed direction must be connected.
 *
 * Rejected:
 *   Every listed direction must NOT be connected.
 *
 * Unlisted:
 *   Either connected or disconnected.
 */
interface WallTileRule {
  gid: number;
  required: number;
  rejected: number;
}

/**
 * Base tile rules.
 *
 * Rules are kept in the order supplied by the user.
 * When two rules have equal specificity, the earlier rule wins.
 *
 * Consequently:
 * - GID 6 is preferred over visual variant GID 8.
 * - GID 2 is preferred over visual variants GID 10 and GID 12.
 */
const WALL_TILE_RULES: readonly WallTileRule[] = [
  // ---------------------------------------------------------
  // Original tiles
  // ---------------------------------------------------------

  // GID 1: S + E [reject W, N]
  {
    gid: 1,
    required: S | E,
    rejected: W | N,
  },

  // GID 2: E + W [reject S]
  {
    gid: 2,
    required: E | W,
    rejected: S,
  },

  // GID 3: S + W [reject E, N]
  {
    gid: 3,
    required: S | W,
    rejected: E | N,
  },

  // GID 4: E + SE + NE + S + N [reject W]
  {
    gid: 4,
    required: E | SE | NE | S | N,
    rejected: W,
  },

  // GID 5: W + SW + NW + S + N [reject E]
  {
    gid: 5,
    required: W | SW | NW | S | N,
    rejected: E,
  },

  // GID 6: S + N [reject W, E]
  {
    gid: 6,
    required: S | N,
    rejected: W | E,
  },

  // GID 7: Fully boxed in
  {
    gid: 7,
    required: N | E | S | W | NE | SE | SW | NW,
    rejected: 0,
  },

  // GID 8: S + N [reject W, E] (visual variant)
  {
    gid: 8,
    required: S | N,
    rejected: W | E,
  },

  // GID 9: W + E + SW + SE + S [reject NW, NE]
  {
    gid: 9,
    required: W | E | SW | SE | S,
    rejected: NW | NE,
  },

  // GID 10: E + W [reject S] (visual variant)
  {
    gid: 10,
    required: E | W,
    rejected: S,
  },

  // GID 11: E + N [reject S, W]
  {
    gid: 11,
    required: E | N,
    rejected: S | W,
  },

  // GID 12: W + E [reject S] (visual variant)
  {
    gid: 12,
    required: W | E,
    rejected: S,
  },

  // GID 13: W + N [reject S, E]
  {
    gid: 13,
    required: W | N,
    rejected: S | E,
  },

  // GID 14: W + E + SW + SE + S [reject N]
  {
    gid: 14,
    required: W | E | SW | SE | S,
    rejected: N,
  },

  // ---------------------------------------------------------
  // Expanded tiles
  // ---------------------------------------------------------

  // GID 41: E + S + N [reject W, SE]; FLIP_H
  {
    gid: tile(41, FLIP_H),
    required: E | S | N,
    rejected: W | SE,
  },

  // GID 42: W + S + N + E + NE + SE [reject SW]; FLIP_H
  {
    gid: tile(42, FLIP_H),
    required: W | S | N | E | NE | SE,
    rejected: SW,
  },

  // GID 43: W + N + S + SW + E + NE + SE
  // [reject NW]; FLIP_H
  {
    gid: tile(43, FLIP_H),
    required: W | N | S | SW | E | NE | SE,
    rejected: NW,
  },

  // GID 44: W + E + S + SE [reject SW, NE]; FLIP_H
  {
    gid: tile(44, FLIP_H),
    required: W | E | S | SE,
    rejected: SW | NE,
  },

  // GID 46: W [reject S, E]; FLIP_H
  {
    gid: tile(46, FLIP_H),
    required: W,
    rejected: S | E,
  },

  // GID 47: N [reject S, W, E]
  {
    gid: 47,
    required: N,
    rejected: S | W | E,
  },

  // GID 48: S [reject N, W, E]
  {
    gid: 48,
    required: S,
    rejected: N | W | E,
  },

  // GID 49: W + E + S [reject SW, SE]
  {
    gid: 49,
    required: W | E | S,
    rejected: SW | SE,
  },

  // GID 50: N + S + E + SE [reject W]
  {
    gid: tile(50, FLIP_H),
    required: N | S | E | SE,
    rejected: W,
  },
];

/**
 * Horizontally mirrors an eight-direction connectivity mask.
 *
 * N and S remain unchanged.
 * E and W are exchanged.
 * NE and NW are exchanged.
 * SE and SW are exchanged.
 */
function flipHorizontalMask(mask: number): number {
  let result = mask & (N | S);

  if (mask & E) result |= W;
  if (mask & W) result |= E;

  if (mask & NE) result |= NW;
  if (mask & NW) result |= NE;

  if (mask & SE) result |= SW;
  if (mask & SW) result |= SE;

  return result;
}

/**
 * Counts the number of constrained directions in a rule.
 *
 * More constrained rules are considered more specific.
 */
function getRuleSpecificity(rule: WallTileRule): number {
  let value = (rule.required | rule.rejected) & ALL_DIRECTIONS;
  let count = 0;

  while (value !== 0) {
    count += value & 1;
    value >>>= 1;
  }

  return count;
}

/**
 * Checks whether a connectivity mask satisfies a rule.
 */
function matchesRule(
  mask: number,
  rule: WallTileRule,
): boolean {
  const hasAllRequired =
    (mask & rule.required) === rule.required;

  const hasNoRejected =
    (mask & rule.rejected) === 0;

  return hasAllRequired && hasNoRejected;
}

/**
 * Expands the supplied rules into one complete 256-entry lookup table.
 *
 * Every possible eight-direction mask receives an output:
 *
 * - A dedicated tile when a rule matches.
 * - GID 45 when no dedicated rule matches.
 *
 * Rules with more required/rejected directions take precedence.
 * When specificity is equal, the first declared rule wins.
 *
 * Horizontal-flip rules automatically generate their mirrored
 * connectivity patterns, with the horizontal flag toggled.
 */
function createWallTileLookup(): Readonly<Record<number, number>> {
  const expandedRules: WallTileRule[] = [];

  for (const rule of WALL_TILE_RULES) {
  const hasHorizontalFlip = (rule.gid & FLIP_H) !== 0;

  if (!hasHorizontalFlip) {
    expandedRules.push(rule);
    continue;
  }

  // Original connectivity: remove the horizontal flip.
  expandedRules.push({
    ...rule,
    gid: (rule.gid ^ FLIP_H) >>> 0,
  });

  // Mirrored connectivity: apply the horizontal flip.
  expandedRules.push({
    gid: rule.gid >>> 0,
    required: flipHorizontalMask(rule.required),
    rejected: flipHorizontalMask(rule.rejected),
  });
}

  const lookup: Record<number, number> = {};

  // Generate every possible combination of eight neighbor directions.
  for (let mask = 0; mask <= ALL_DIRECTIONS; mask++) {
    let selectedGid = FALLBACK_WALL_GID;
    let selectedSpecificity = -1;

    for (const rule of expandedRules) {
      if (!matchesRule(mask, rule)) {
        continue;
      }

      const specificity = getRuleSpecificity(rule);

      // A more specific rule replaces a less specific rule.
      // Equal-specificity ties preserve the earlier rule.
      if (specificity > selectedSpecificity) {
        selectedGid = rule.gid;
        selectedSpecificity = specificity;
      }
    }

    lookup[mask] = selectedGid >>> 0;
  }

  return Object.freeze(lookup);
}

/**
 * Complete connectivity lookup.
 *
 * Key:
 *   Eight-direction neighbor mask, 0–255.
 *
 * Value:
 *   Final Tiled GID, optionally containing transformation flags.
 *
 * This is the only lookup table used during autotiling.
 */
export const WALL_TILE_LOOKUP = createWallTileLookup();

export interface AutoTilerOptions {
  sourceLayerName?: string;
  targetLayerName?: string;
  baseWallGid?: number;
}

/**
 * Reads wall-outline markers and generates the final wall tiles.
 *
 * Source layer:
 * - baseWallGid: wall cell
 * - 0: non-wall cell
 *
 * Connectivity is evaluated in all eight directions.
 *
 * All 256 possible masks are handled by WALL_TILE_LOOKUP.
 * Unsupported patterns receive FALLBACK_WALL_GID.
 *
 * The target layer is completely rebuilt.
 * The original TiledMap is not mutated.
 */
export function autoTileWalls(
  tiledMap: TiledMap,
  options: AutoTilerOptions = {},
): TiledMap {
  const sourceLayerName = options.sourceLayerName ?? "walloutline";
  const targetLayerName = options.targetLayerName ?? "wall";
  const baseWallGid = options.baseWallGid ?? BASE_WALL_GID;

  const sourceLayer = tiledMap.layers.find(
    (layer) => layer.name === sourceLayerName,
  );

  const targetLayer = tiledMap.layers.find(
    (layer) => layer.name === targetLayerName,
  );

  if (!sourceLayer || !targetLayer) {
    throw new Error(
      `AutoTiler: Missing required layers "${sourceLayerName}" or "${targetLayerName}".`,
    );
  }

  if (!sourceLayer.data || !targetLayer.data) {
    throw new Error(
      "AutoTiler: Both source and target layers must be tile layers.",
    );
  }

  const { width, height } = tiledMap;

  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width <= 0 ||
    height <= 0
  ) {
    throw new Error(
      "AutoTiler: Map dimensions must be positive integers.",
    );
  }

  const expectedLength = width * height;

  if (
    sourceLayer.data.length !== expectedLength ||
    targetLayer.data.length !== expectedLength
  ) {
    throw new Error(
      "AutoTiler: Layer data dimensions do not match the map dimensions.",
    );
  }

  const source = sourceLayer.data;
  const output = new Array<number>(expectedLength).fill(0);

  /**
   * Checks whether a cell contains a wall marker.
   */
  const isWall = (x: number, y: number): boolean => {
    if (
      x < 0 ||
      y < 0 ||
      x >= width ||
      y >= height
    ) {
      return false;
    }

    return source[y * width + x] === baseWallGid;
  };

  /**
   * Calculates the complete eight-direction connectivity mask.
   */
  const getConnectivity = (x: number, y: number): number => {
    let mask = 0;

    // Cardinal neighbors.
    if (isWall(x, y - 1)) mask |= N;
    if (isWall(x + 1, y)) mask |= E;
    if (isWall(x, y + 1)) mask |= S;
    if (isWall(x - 1, y)) mask |= W;

    // Diagonal neighbors.
    if (isWall(x + 1, y - 1)) mask |= NE;
    if (isWall(x + 1, y + 1)) mask |= SE;
    if (isWall(x - 1, y + 1)) mask |= SW;
    if (isWall(x - 1, y - 1)) mask |= NW;

    return mask & ALL_DIRECTIONS;
  };

  // Process every wall-outline cell.
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = y * width + x;

      if (source[index] !== baseWallGid) {
        continue;
      }

      const mask = getConnectivity(x, y);

      // The lookup always contains a value for masks 0–255.
      output[index] = WALL_TILE_LOOKUP[mask];
    }
  }

  // Replace the target layer's tile data.
  const newLayers: TiledLayer[] = tiledMap.layers.map((layer) => {
    if (layer.name !== targetLayerName) {
      return layer;
    }

    return {
      ...layer,
      data: output,
    };
  });

  return {
    ...tiledMap,
    layers: newLayers,
  };
}
