
import type { TiledMap, TiledLayer } from "../TiledMap.js";

/**
 * Cardinal direction bit flags.
 *
 * N = 0001
 * E = 0010
 * S = 0100
 * W = 1000
 */
const N = 1;
const E = 2;
const S = 4;
const W = 8;

/**
 * Base wall-outline tile.
 *
 * GID 7 = "+" in the supplied tileset.
 */
const BASE_WALL_GID = 7;

/**
 * Wall connectivity -> final wall GID.
 *
 * Tiled GIDs are global IDs, so these values include
 * the tileset's firstgid (1).
 */
export const WALL_TILE_LOOKUP: Readonly<Record<number, number>> = {
    // Corners
    [N | E]: 11,
    [N | W]: 13,
    [S | E]: 1,
    [S | W]: 3,

    // Straight walls
    [N]: 6,
    [S]: 6,
    [N | S]: 6,

    [E]: 2,
    [W]: 2,
    [E | W]: 2,

    // T-junctions
    [N | S | E]: 4,
    [N | S | W]: 5,
    [S | E | W]: 9,
    [N | E | W]: 10,

    // Four-way intersection
    [N | E | S | W]: 7,

    // Isolated wall tile
    [0]: 14,
};

export interface AutoTilerOptions {
    sourceLayerName?: string;
    targetLayerName?: string;
    baseWallGid?: number;
}

/**
 * Reads wall-outline markers and generates the final wall tiles.
 *
 * The source layer is used as a binary wall mask:
 * - baseWallGid: wall cell
 * - 0: non-wall cell
 *
 * The target layer is completely rebuilt.
 *
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
        layer => layer.name === sourceLayerName,
    );

    const targetLayer = tiledMap.layers.find(
        layer => layer.name === targetLayerName,
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
        if (x < 0 || y < 0 || x >= width || y >= height) {
            return false;
        }

        return source[y * width + x] === baseWallGid;
    };

    /**
     * Calculates the connectivity mask for a wall cell.
     */
    const getConnectivity = (x: number, y: number): number => {
        let mask = 0;

        if (isWall(x, y - 1)) mask |= N;
        if (isWall(x + 1, y)) mask |= E;
        if (isWall(x, y + 1)) mask |= S;
        if (isWall(x - 1, y)) mask |= W;

        return mask;
    };

    /**
     * Resolves a connectivity mask to a wall GID.
     */
    const getWallGid = (mask: number): number => {
        const gid = WALL_TILE_LOOKUP[mask];

        if (gid === undefined) {
            throw new Error(
                `AutoTiler: No wall tile defined for connectivity mask ${mask}.`,
            );
        }

        return gid;
    };

    // Process every wall-outline cell.
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const index = y * width + x;

            if (source[index] !== baseWallGid) {
                continue;
            }

            const mask = getConnectivity(x, y);

            output[index] = getWallGid(mask);
        }
    }

    // Replace the target layer's tile data.
    const newLayers: TiledLayer[] = tiledMap.layers.map(layer => {
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
