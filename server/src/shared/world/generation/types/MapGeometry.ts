/**
 * Coordinates in the map's tile grid.
 *
 * x increases to the right.
 * y increases downwards.
 * Both coordinates must be integers.
 */
export interface TilePoint {
  x: number;
  y: number;
}

/**
 * Coordinates in Tiled's pixel coordinate system.
 * Conversion into these coordinates should happen
 * only inside TilemapAssembler.
 */
export interface PixelPoint {
  x: number;
  y: number;
}

/**
 * Rectangle represented in tile coordinates.
 *
 * x, y: top-left tile
 * width, height: dimensions in tiles
 *
 * The occupied area follows half-open boundaries:
 * [x, x + width) and [y, y + height).
 */
export interface TileRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type CardinalDirection =
  | "NORTH"
  | "EAST"
  | "SOUTH"
  | "WEST";

/**
 * Fixed dimensions of the existing Hub tileset.
 */
export const TILE_WIDTH = 8;
export const TILE_HEIGHT = 8;

/**
 * Converts a tile coordinate into the pixel
 * coordinate of the tile's top-left corner.
 */
export function tileToPixelTopLeft(
  point: TilePoint,
): PixelPoint {
  return {
    x: point.x * TILE_WIDTH,
    y: point.y * TILE_HEIGHT,
  };
}

/**
 * Converts a tile coordinate into the pixel
 * coordinate of its center.
 *
 * Particularly useful for Tiled point objects.
 */
export function tileToPixelCenter(
  point: TilePoint,
): PixelPoint {
  return {
    x: (point.x + 0.5) * TILE_WIDTH,
    y: (point.y + 0.5) * TILE_HEIGHT,
  };
}

/**
 * Converts a pixel position into its containing tile.
 */
export function pixelToTile(
  point: PixelPoint,
): TilePoint {
  return {
    x: Math.floor(point.x / TILE_WIDTH),
    y: Math.floor(point.y / TILE_HEIGHT),
  };
}