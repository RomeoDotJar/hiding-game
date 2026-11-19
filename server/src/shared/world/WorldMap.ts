import { TILEMAP_UPSCALE } from "../constants";
import { TiledLayer, TiledMap, TiledObject } from "./TiledMap";

export class WorldMap {
  mapData: TiledMap;
  tileWidth: number;
  tileHeight: number;
  cols: number;
  rows: number;

  objLayer: TiledLayer;
  
  // A flat 1D array for blazing-fast collision checks
  // 0 = empty, 1 = solid wall
  collisionGrid: Uint8Array;

  // Pass the already-loaded JSON object into the constructor
  constructor(mapData: TiledMap) {
    this.mapData = mapData;
    this.tileWidth = mapData.tilewidth;
    this.tileHeight = mapData.tileheight;
    this.cols = mapData.width;
    this.rows = mapData.height;

    this.objLayer = mapData.layers.find((val:TiledLayer)=>val.name=='Objs');
    
    this.collisionGrid = new Uint8Array(this.cols * this.rows);
    this.buildCollisionGrid();
  }

  private buildCollisionGrid() {
    const wallsLayer = this.mapData.layers.find(l => l.name === "wall");
    if (!wallsLayer || !wallsLayer.data) return;

    // Tiled uses 0 for empty. Any ID > 0 is a wall tile in this layer.
    for (let i = 0; i < wallsLayer.data.length; i++) {
      if (wallsLayer.data[i] > 0) {
        this.collisionGrid[i] = 1;
      }
    }
  }

  public getObj(predicate: (value: TiledObject, index: number) => unknown) {
    return this.objLayer.objects.find(predicate);
  }

  // Check if a specific grid cell is solid
  public isSolid(tileX: number, tileY: number): boolean {
    if (tileX < 0 || tileX >= this.cols || tileY < 0 || tileY >= this.rows) {
      return false; // Treat out-of-bounds as empty air
    }
    return this.collisionGrid[tileY * this.cols + tileX] === 1;
  }

  /**
   * Circle-Tile Collision Check
   * Checks if a circle (player/monster) at (x, y) with a radius intersects any solid tile.
   */
  public checkCircleCollision(x: number, y: number, radius: number): boolean {
    // 1. Find the range of grid cells the circle's bounding box overlaps
    const minTileX = Math.floor((x - radius) / this.tileWidth);
    const maxTileX = Math.floor((x + radius) / this.tileWidth);
    const minTileY = Math.floor((y - radius) / this.tileHeight);
    const maxTileY = Math.floor((y + radius) / this.tileHeight);

    // 2. Check each overlapping tile
    for (let ty = minTileY; ty <= maxTileY; ty++) {
      for (let tx = minTileX; tx <= maxTileX; tx++) {
        if (this.isSolid(tx, ty)) {
          // 3. Circle vs AABB (Axis-Aligned Bounding Box) math
          const tileLeft = tx * this.tileWidth;
          const tileRight = tileLeft + this.tileWidth;
          const tileTop = ty * this.tileHeight;
          const tileBottom = tileTop + this.tileHeight;

          // Find the closest point on the tile to the circle's center
          const closestX = Math.max(tileLeft, Math.min(x, tileRight));
          const closestY = Math.max(tileTop, Math.min(y, tileBottom));

          // Calculate distance squared (faster than Math.sqrt)
          const dx = x - closestX;
          const dy = y - closestY;
          const distanceSquared = dx * dx + dy * dy;

          if (distanceSquared < radius * radius) {
            return true; // Collision detected!
          }
        }
      }
    }
    return false;
  }

  /**
   * DDA Raycasting
   * Traces a ray from (x1, y1) to (x2, y2) and returns the exact point of intersection with a wall.
   * Returns null if the line of sight is clear.
   */
  public raycast(x1: number, y1: number, x2: number, y2: number): { x: number, y: number } | null {
    // 0. Check if starting point is already inside a wall
    const startTileX = Math.floor(x1 / this.tileWidth);
    const startTileY = Math.floor(y1 / this.tileHeight);
    if (this.isSolid(startTileX, startTileY)) {
      return { x: x1, y: y1 };
    }

    const dx = x2 - x1;
    const dy = y2 - y1;
    
    // Distance to travel
    const distance = Math.sqrt(dx * dx + dy * dy);
    if (distance === 0) return null;

    // Normalize direction
    const dirX = dx / distance;
    const dirY = dy / distance;

    // Current grid cell
    let mapX = startTileX;
    let mapY = startTileY;

    // Length of ray from one side to next
    const deltaDistX = Math.abs(1 / dirX);
    const deltaDistY = Math.abs(1 / dirY);

    // Step direction and initial side distance
    let stepX, stepY;
    let sideDistX, sideDistY;

    if (dirX < 0) {
      stepX = -1;
      sideDistX = (x1 / this.tileWidth - mapX) * deltaDistX;
    } else {
      stepX = 1;
      sideDistX = (mapX + 1.0 - x1 / this.tileWidth) * deltaDistX;
    }

    if (dirY < 0) {
      stepY = -1;
      sideDistY = (y1 / this.tileHeight - mapY) * deltaDistY;
    } else {
      stepY = 1;
      sideDistY = (mapY + 1.0 - y1 / this.tileHeight) * deltaDistY;
    }

    // DDA Loop
    while (true) {
      // side = 0 means we hit a vertical wall (X-axis)
      // side = 1 means we hit a horizontal wall (Y-axis)
      let side: 0 | 1;

      if (sideDistX < sideDistY) {
        sideDistX += deltaDistX;
        mapX += stepX;
        side = 0;
      } else {
        sideDistY += deltaDistY;
        mapY += stepY;
        side = 1;
      }

      // If we hit a wall, calculate exact intersection point
      if (this.isSolid(mapX, mapY)) {
        let hitX, hitY;

        if (side === 0) {
          // Hit a vertical wall (left or right edge of the tile)
          hitX = (stepX > 0) ? mapX * this.tileWidth : (mapX + 1) * this.tileWidth;
          // Use linear interpolation to find the exact Y coordinate
          hitY = y1 + (hitX - x1) * (dy / dx);
        } else {
          // Hit a horizontal wall (top or bottom edge of the tile)
          hitY = (stepY > 0) ? mapY * this.tileHeight : (mapY + 1) * this.tileHeight;
          // Use linear interpolation to find the exact X coordinate
          hitX = x1 + (hitY - y1) * (dx / dy);
        }

        return { x: hitX, y: hitY };
      }

      // Stop if we've gone further than the target distance
      const currentDist = Math.sqrt(
        Math.pow((mapX + 0.5) * this.tileWidth - x1, 2) + 
        Math.pow((mapY + 0.5) * this.tileHeight - y1, 2)
      );
      if (currentDist > distance) break;
    }

    return null; // Clear line of sight
  }
}