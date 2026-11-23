import { PRNG } from "../PRNG.js";
import type { TiledMap } from "./TiledMap.js";

/**
 * Optional controls for procedural map generation.
 *
 * wallDensity is the target fraction of buildable interior tiles occupied by
 * walls. It is a target rather than a guarantee: small maps, thick walls and
 * large minPathwayWidth values can make the requested density impossible.
 *
 * minPathwayWidth is the minimum number of clear tiles kept between separate
 * wall groups (measured conservatively in all eight directions).
 */
export interface MapGenerationOptions {
  width?: number;
  height?: number;
  wallDensity?: number;
  minPathwayWidth?: number;
  /**
   * Target average length of one continuous interior wall segment, in tiles.
   * L-shaped segments count the lengths of both arms, excluding the shared joint.
   * For thick walls, this measures the centreline rather than the full footprint.
   */
  wallAverageLength?: number;
  /** Minimum generated wall thickness, in tiles (inclusive). */
  minWallThickness?: number;
  /** Maximum generated wall thickness, in tiles (inclusive). */
  maxWallThickness?: number;
  /**
   * Desired fraction of straight wall candidates, from 0 to 1.
   * The remaining fraction is used for L-shaped candidates.
   * For example, 0.7 generates approximately 70% straight and 30% L-shaped walls.
   */
  straightWallRatio?: number;
  decorate?: boolean;
}

const DEFAULT_OPTIONS: Required<MapGenerationOptions> = {
  width: 100,
  height: 60,
  wallDensity: 0.5,
  minPathwayWidth: 2,
  wallAverageLength: 12,
  // Preserve the previous 1–2 tile thickness range, with thin walls favored.
  minWallThickness: 2,
  maxWallThickness: 3,
  
  straightWallRatio: 0.5,
  decorate: true,
};

interface Point {
  x: number;
  y: number;
}

/**
 * Procedurally generates a finite Tiled map in the same format/style as the Hub.
 *
 * Hub conventions preserved here:
 * - 8x8 tiles and an external tilemap_packed.tsx tileset (firstgid = 1)
 * - layer order/names: Floor, walloutline, wall, Ceiling, Objs
 * - the same atlas tile IDs used by the Hub for floor, walls, outlines and ceiling
 * - a point object named MainSpawnArea with type SpawnArea at pixel (36, 36)
 *
 * The same seed and options always produce the same map.
 */
export function generateGameBoard(
  seed: number,
  options: MapGenerationOptions = {},
): TiledMap {
  const config: Required<MapGenerationOptions> = {
    width: options.width ?? DEFAULT_OPTIONS.width,
    height: options.height ?? DEFAULT_OPTIONS.height,
    wallDensity: options.wallDensity ?? DEFAULT_OPTIONS.wallDensity,
    minPathwayWidth: options.minPathwayWidth ?? DEFAULT_OPTIONS.minPathwayWidth,
    wallAverageLength: options.wallAverageLength ?? DEFAULT_OPTIONS.wallAverageLength,
    minWallThickness: options.minWallThickness ?? DEFAULT_OPTIONS.minWallThickness,
    maxWallThickness: options.maxWallThickness ?? DEFAULT_OPTIONS.maxWallThickness,
    straightWallRatio: options.straightWallRatio ?? DEFAULT_OPTIONS.straightWallRatio,
    decorate: options.decorate ?? DEFAULT_OPTIONS.decorate,
  };
  const width = config.width;
  const height = config.height;

  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 14 ||
    height < 12
  ) {
    throw new Error("Map dimensions must be integers (width >= 14, height >= 12).");
  }
  if (!Number.isFinite(seed)) {
    throw new Error("Seed must be a finite number.");
  }
  if (!Number.isFinite(config.wallDensity) || config.wallDensity < 0 || config.wallDensity > 1) {
    throw new Error("wallDensity must be a number between 0 and 1.");
  }
  if (!Number.isInteger(config.minPathwayWidth) || config.minPathwayWidth < 1) {
    throw new Error("minPathwayWidth must be a positive integer.");
  }
  if (!Number.isFinite(config.wallAverageLength) || config.wallAverageLength < 3) {
    throw new Error("wallAverageLength must be a finite number greater than or equal to 3.");
  }
  if (!Number.isInteger(config.minWallThickness) || config.minWallThickness < 1) {
    throw new Error("minWallThickness must be a positive integer.");
  }
  if (!Number.isInteger(config.maxWallThickness) || config.maxWallThickness < config.minWallThickness) {
    throw new Error("maxWallThickness must be an integer greater than or equal to minWallThickness.");
  }
  if (
    !Number.isFinite(config.straightWallRatio) ||
    config.straightWallRatio < 0 ||
    config.straightWallRatio > 1
  ) {
    throw new Error("straightWallRatio must be a number between 0 and 1.");
  }
  if (typeof config.decorate !== "boolean") {
    throw new Error("decorate must be a boolean.");
  }

  const interiorMinX = 2;
  const interiorMaxX = width - 3;
  const interiorMinY = 2;
  const interiorMaxY = height - 3;
  const interiorWidth = interiorMaxX - interiorMinX + 1;
  const interiorHeight = interiorMaxY - interiorMinY + 1;
  const maxSupportedThickness = Math.min(interiorWidth, interiorHeight);
  if (config.maxWallThickness > maxSupportedThickness) {
    throw new Error(
      `maxWallThickness cannot exceed ${maxSupportedThickness} for a ${width}x${height} map.`,
    );
  }

  const TILE_SIZE = 8;
  const cellCount = width * height;
  const rng = new PRNG(seed);
  const wallCells = new Uint8Array(cellCount);
  const floor = new Array<number>(cellCount).fill(gid(14)); // Hub's base floor tile.
  const wall = new Array<number>(cellCount).fill(0);
  const wallOutline = new Array<number>(cellCount).fill(0);
  const ceiling = new Array<number>(cellCount).fill(0);

  // Hub's SpawnArea is at (36, 36) pixels, i.e. tile (4, 4) at 8x8 tile size.
  // A clear 3x3 zone is reserved around it.
  const spawnTileX = 4;
  const spawnTileY = 4;
  const spawnClearance = (x: number, y: number): boolean =>
    Math.abs(x - spawnTileX) <= 1 && Math.abs(y - spawnTileY) <= 1;

  const index = (x: number, y: number): number => y * width + x;
  const inBounds = (x: number, y: number): boolean =>
    x >= 0 && x < width && y >= 0 && y < height;

  // The Hub-style perimeter is kept separate from wallDensity. Density applies
  // only to the buildable interior, not to this compulsory boundary.
  for (let x = 1; x < width - 1; x++) {
    wallCells[index(x, 1)] = 1;
    wallCells[index(x, height - 2)] = 1;
  }
  for (let y = 1; y < height - 1; y++) {
    wallCells[index(1, y)] = 1;
    wallCells[index(width - 2, y)] = 1;
  }

  // Count only cells that are eligible for generated walls. The SpawnArea
  // clearance is excluded from the denominator and is never obstructed.
  let buildableCellCount = 0;
  for (let y = interiorMinY; y <= interiorMaxY; y++) {
    for (let x = interiorMinX; x <= interiorMaxX; x++) {
      if (!spawnClearance(x, y)) buildableCellCount++;
    }
  }
  const targetWallCount = Math.round(buildableCellCount * config.wallDensity);

  /**
   * Samples a centreline segment length around the configured average. A
   * triangular spread keeps most walls close to the requested average.
   */
  const sampleWallLength = (maxAvailable: number, minLength = 3): number => {
    if (maxAvailable < minLength) return maxAvailable;
    const variation = (rng.next() + rng.next()) / 2;
    const factor = 0.6 + variation * 0.8;
    return clamp(Math.round(config.wallAverageLength * factor), minLength, maxAvailable);
  };

  /**
   * Samples thickness from the inclusive configured range, favoring the thinner
   * end. This keeps the old mostly-one-tile look by default while still allowing
   * thicker walls to appear; every value in the range remains possible.
   */
  const sampleWallThickness = (): number => {
    const range = config.maxWallThickness - config.minWallThickness + 1;
    const biasedRoll = Math.pow(rng.next(), 2.5);
    return config.minWallThickness + Math.min(range - 1, Math.floor(biasedRoll * range));
  };

  /** Adds unique points to a candidate while preserving their path order. */
  const createPointCollector = (): {
    points: Point[];
    add: (x: number, y: number) => void;
  } => {
    const points: Point[] = [];
    const seen = new Set<number>();
    return {
      points,
      add: (x: number, y: number): void => {
        const pointIndex = index(x, y);
        if (!seen.has(pointIndex)) {
          seen.add(pointIndex);
          points.push({ x, y });
        }
      },
    };
  };

  /**
   * Creates a continuous straight or L-shaped interior wall. Thickness is
   * applied perpendicular to straight runs. L-shaped walls use perpendicular
   * strips plus a filled square at the joint, producing a continuous elbow.
   */
  const createWallCandidate = (): Point[] => {
    // straightWallRatio = 1 produces only straight candidates;
    // straightWallRatio = 0 produces only L-shaped candidates.
    const makeLShape = rng.next() >= config.straightWallRatio;
    const thickness = sampleWallThickness();

    if (!makeLShape) {
      const horizontal = rng.next() < 0.5;
      const length = sampleWallLength(horizontal ? interiorWidth : interiorHeight);
      const thicknessDirection: -1 | 1 = rng.next() < 0.5 ? -1 : 1;
      const collector = createPointCollector();

      if (horizontal) {
        const startX = randomInt(rng, interiorMinX, interiorMaxX - length + 1);
        const minY =
          thicknessDirection === 1 ? interiorMinY : interiorMinY + thickness - 1;
        const maxY =
          thicknessDirection === 1 ? interiorMaxY - thickness + 1 : interiorMaxY;
        const baseY = randomInt(rng, minY, maxY);

        for (let step = 0; step < length; step++) {
          for (let offset = 0; offset < thickness; offset++) {
            collector.add(startX + step, baseY + offset * thicknessDirection);
          }
        }
      } else {
        const startY = randomInt(rng, interiorMinY, interiorMaxY - length + 1);
        const minX =
          thicknessDirection === 1 ? interiorMinX : interiorMinX + thickness - 1;
        const maxX =
          thicknessDirection === 1 ? interiorMaxX - thickness + 1 : interiorMaxX;
        const baseX = randomInt(rng, minX, maxX);

        for (let step = 0; step < length; step++) {
          for (let offset = 0; offset < thickness; offset++) {
            collector.add(baseX + offset * thicknessDirection, startY + step);
          }
        }
      }

      return collector.points;
    }

    // L-shaped partitions create room corners. Their combined centreline arm
    // length is sampled around wallAverageLength, with one shared joint.
    const maxCombinedLength = interiorWidth + interiorHeight - 1;
    const totalLength = sampleWallLength(maxCombinedLength, 5);
    const horizontalShare = 0.4 + rng.next() * 0.2;
    let horizontalLength = clamp(
      Math.round((totalLength - 1) * horizontalShare),
      2,
      interiorWidth,
    );
    let verticalLength = totalLength - horizontalLength + 1;

    if (verticalLength > interiorHeight) {
      verticalLength = interiorHeight;
      horizontalLength = Math.min(interiorWidth, totalLength - verticalLength + 1);
    }
    if (horizontalLength > interiorWidth) {
      horizontalLength = interiorWidth;
      verticalLength = Math.min(interiorHeight, totalLength - horizontalLength + 1);
    }
    if (horizontalLength < 2 || verticalLength < 2) return [];

    const horizontalDirection: -1 | 1 = rng.next() < 0.5 ? -1 : 1;
    const verticalDirection: -1 | 1 = rng.next() < 0.5 ? -1 : 1;
    // These directions define the side on which each arm's thickness is added.
    const horizontalThicknessDirection: -1 | 1 = rng.next() < 0.5 ? -1 : 1;
    const verticalThicknessDirection: -1 | 1 = rng.next() < 0.5 ? -1 : 1;

    // The horizontal arm controls the joint's X range; the vertical arm's
    // thickness also consumes space along X. Both constraints are combined.
    let minJointX =
      horizontalDirection === 1 ? interiorMinX : interiorMinX + horizontalLength - 1;
    let maxJointX =
      horizontalDirection === 1 ? interiorMaxX - horizontalLength + 1 : interiorMaxX;
    if (verticalThicknessDirection === 1) {
      maxJointX = Math.min(maxJointX, interiorMaxX - thickness + 1);
    } else {
      minJointX = Math.max(minJointX, interiorMinX + thickness - 1);
    }

    // The vertical arm controls the joint's Y range; the horizontal arm's
    // thickness also consumes space along Y.
    let minJointY =
      verticalDirection === 1 ? interiorMinY : interiorMinY + verticalLength - 1;
    let maxJointY =
      verticalDirection === 1 ? interiorMaxY - verticalLength + 1 : interiorMaxY;
    if (horizontalThicknessDirection === 1) {
      maxJointY = Math.min(maxJointY, interiorMaxY - thickness + 1);
    } else {
      minJointY = Math.max(minJointY, interiorMinY + thickness - 1);
    }

    if (minJointX > maxJointX || minJointY > maxJointY) return [];

    const jointX = randomInt(rng, minJointX, maxJointX);
    const jointY = randomInt(rng, minJointY, maxJointY);
    const collector = createPointCollector();

    // Horizontal strip.
    for (let step = 0; step < horizontalLength; step++) {
      for (let offset = 0; offset < thickness; offset++) {
        collector.add(
          jointX + step * horizontalDirection,
          jointY + offset * horizontalThicknessDirection,
        );
      }
    }

    // Vertical strip.
    for (let step = 0; step < verticalLength; step++) {
      for (let offset = 0; offset < thickness; offset++) {
        collector.add(
          jointX + offset * verticalThicknessDirection,
          jointY + step * verticalDirection,
        );
      }
    }

    // Fill the square elbow between the two perpendicular strips. Without this,
    // a thick L could have a diagonal notch at its inside corner.
    for (let offsetY = 0; offsetY < thickness; offsetY++) {
      for (let offsetX = 0; offsetX < thickness; offsetX++) {
        collector.add(
          jointX + offsetX * verticalThicknessDirection,
          jointY + offsetY * horizontalThicknessDirection,
        );
      }
    }

    return collector.points;
  };

  /**
   * Keeps a full minPathwayWidth clearance around each separate wall group.
   * Chebyshev distance is used deliberately, so diagonal pinches are avoided.
   */
  const candidateHasClearance = (points: Point[]): boolean => {
    const clearance = config.minPathwayWidth;

    for (const point of points) {
      const { x, y } = point;
      if (
        x < interiorMinX ||
        x > interiorMaxX ||
        y < interiorMinY ||
        y > interiorMaxY ||
        spawnClearance(x, y) ||
        wallCells[index(x, y)] !== 0
      ) {
        return false;
      }

      for (let dy = -clearance; dy <= clearance; dy++) {
        for (let dx = -clearance; dx <= clearance; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (inBounds(nx, ny) && wallCells[index(nx, ny)] !== 0) {
            return false;
          }
        }
      }
    }

    return true;
  };

  /** Ensures that every remaining interior floor tile can be reached from spawn. */
  const allInteriorFloorIsConnected = (): boolean => {
    const spawnIndex = index(spawnTileX, spawnTileY);
    if (wallCells[spawnIndex] !== 0) return false;

    const visited = new Uint8Array(cellCount);
    const queue = new Int32Array(cellCount);
    let head = 0;
    let tail = 0;
    let walkableCount = 0;

    for (let y = interiorMinY; y <= interiorMaxY; y++) {
      for (let x = interiorMinX; x <= interiorMaxX; x++) {
        if (wallCells[index(x, y)] === 0) walkableCount++;
      }
    }

    queue[tail++] = spawnIndex;
    visited[spawnIndex] = 1;
    let reachedCount = 1;

    while (head < tail) {
      const current = queue[head++];
      const x = current % width;
      const y = Math.floor(current / width);
      const neighbors: Point[] = [
        { x: x + 1, y },
        { x: x - 1, y },
        { x, y: y + 1 },
        { x, y: y - 1 },
      ];

      for (const neighbor of neighbors) {
        if (
          neighbor.x < interiorMinX ||
          neighbor.x > interiorMaxX ||
          neighbor.y < interiorMinY ||
          neighbor.y > interiorMaxY
        ) {
          continue;
        }

        const neighborIndex = index(neighbor.x, neighbor.y);
        if (wallCells[neighborIndex] === 0 && visited[neighborIndex] === 0) {
          visited[neighborIndex] = 1;
          queue[tail++] = neighborIndex;
          reachedCount++;
        }
      }
    }

    return reachedCount === walkableCount;
  };

  // Add whole wall segments until the requested density is reached or the
  // remaining free space cannot accept another segment. Candidates are never
  // sliced to fit the remaining density target, because doing so could leave a
  // partially thick or abruptly truncated wall at its endpoint.
  let placedWallCount = 0;
  let attemptsWithoutPlacement = 0;
  const maxAttempts = cellCount * 60;
  const maxAttemptsWithoutPlacement = cellCount * 12;

  for (
    let attempt = 0;
    attempt < maxAttempts &&
    placedWallCount < targetWallCount &&
    attemptsWithoutPlacement < maxAttemptsWithoutPlacement;
    attempt++
  ) {
    const candidate = createWallCandidate();
    if (candidate.length === 0) {
      attemptsWithoutPlacement++;
      continue;
    }

    const remainingTarget = targetWallCount - placedWallCount;
    if (candidate.length > remainingTarget) {
      attemptsWithoutPlacement++;
      continue;
    }

    if (!candidateHasClearance(candidate)) {
      attemptsWithoutPlacement++;
      continue;
    }

    for (const point of candidate) {
      wallCells[index(point.x, point.y)] = 1;
    }

    if (allInteriorFloorIsConnected()) {
      placedWallCount += candidate.length;
      attemptsWithoutPlacement = 0;
    } else {
      // Roll back a placement that would isolate an interior floor pocket.
      for (const point of candidate) {
        wallCells[index(point.x, point.y)] = 0;
      }
      attemptsWithoutPlacement++;
    }
  }

  // Convert wall occupancy to the Hub's wall-atlas GIDs. The same atlas tile
  // selection is used for one-, two- and three-tile-thick walls; inner cells of
  // thicker walls use the existing connected-wall tile variant.
  const hasWall = (x: number, y: number): boolean =>
    inBounds(x, y) && wallCells[index(x, y)] === 1;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!wallCells[index(x, y)]) continue;

      const north = hasWall(x, y - 1);
      const east = hasWall(x + 1, y);
      const south = hasWall(x, y + 1);
      const west = hasWall(x - 1, y);
      const neighbors = Number(north) + Number(east) + Number(south) + Number(west);

      let tileId: number;
      if (north && south && !east && !west) {
        tileId = rng.next() < 0.2 ? 15 : 7;
      } else if (east && west && !north && !south) {
        tileId = rng.next() < 0.2 ? 11 : 1;
      } else if (north && east && south && west) {
        tileId = 11;
      } else if (north && east && west) {
        tileId = 9;
      } else if (south && east && west) {
        tileId = 8;
      } else if (north && south && east) {
        tileId = 13;
      } else if (north && south && west) {
        tileId = 6;
      } else if (north && east) {
        tileId = 10;
      } else if (north && west) {
        tileId = 12;
      } else if (south && east) {
        tileId = 0;
      } else if (south && west) {
        tileId = 2;
      } else if (neighbors === 1 && (north || south)) {
        tileId = 5;
      } else {
        tileId = 11;
      }

      wall[index(x, y)] = gid(tileId);
    }
  }

  // Decorative floor accents and ceiling overlays are optional. The structural
  // floor, wall and walloutline layers are generated regardless of this flag.
  if (config.decorate) {
    const paintFloorCell = (x: number, y: number, tileId: number): void => {
      if (!inBounds(x, y) || wallCells[index(x, y)] || spawnClearance(x, y)) return;
      floor[index(x, y)] = gid(tileId);
    };

    const paintPatch = (
      x: number,
      y: number,
      patchWidth: number,
      patchHeight: number,
      tileId: number,
    ): void => {
      for (let py = 0; py < patchHeight; py++) {
        for (let px = 0; px < patchWidth; px++) {
          paintFloorCell(x + px, y + py, tileId);
        }
      }
    };

    // Hub floor accents: small patches using atlas tile 13 and a larger tile-20 patch.
    for (let attempt = 0; attempt < 5; attempt++) {
      const patchX = randomInt(rng, 3, width - 5);
      const patchY = randomInt(rng, 3, height - 5);
      paintPatch(patchX, patchY, 2 + (attempt % 2), 2, 13);
    }

    const rugX = clamp(Math.round(width * 0.32), 3, width - 7);
    const rugY = clamp(Math.round(height * 0.72), 3, height - 5);
    paintPatch(rugX, rugY, 4, 3, 20);

    // The Hub uses a short four-tile floor motif (local tile IDs 27–29).
    const horizontalMotif = [27, 28, 28, 29];
    const motifY = 2;
    const motifX = Math.max(2, width - 14);
    horizontalMotif.forEach((tileId, offset) => paintFloorCell(motifX + offset, motifY, tileId));

    const verticalMotifX = Math.max(2, width - 9);
    const verticalMotifY = clamp(Math.round(height * 0.42), 2, height - 6);
    horizontalMotif.forEach((tileId, offset) =>
      paintFloorCell(verticalMotifX, verticalMotifY + offset, tileId),
    );

    // A single scattered floor detail mirrors the Hub's isolated tile-19 mark.
    paintFloorCell(
      Math.min(4, width - 3),
      Math.min(Math.round(height * 0.52), height - 3),
      19,
    );

    // Ceiling overlays use the Hub's translucent ceiling tile (local tile ID 30).
    const addCeilingRun = (x: number, y: number, runWidth: number, runHeight: number): void => {
      for (let py = 0; py < runHeight; py++) {
        for (let px = 0; px < runWidth; px++) {
          const cx = x + px;
          const cy = y + py;
          if (inBounds(cx, cy) && !spawnClearance(cx, cy)) {
            ceiling[index(cx, cy)] = gid(30);
          }
        }
      }
    };

    addCeilingRun(3, 4, 1, 1);
    addCeilingRun(clamp(Math.round(width * 0.30), 3, width - 6), 4, 3, 1);
    addCeilingRun(width - 5, clamp(Math.round(height * 0.45), 4, height - 5), 1, 3);
    if (rng.next() < 0.7) {
      addCeilingRun(clamp(Math.round(width * 0.54), 3, width - 6), height - 6, 3, 1);
    }
  }

  // Hidden wall-outline layer, matching the Hub's tile IDs and visibility.
  // GID 26 (local tile 25) frames the map; GID 7 (local tile 6) marks a
  // one-cell halo around walls, including thicker wall footprints.
  for (let x = 0; x < width; x++) {
    wallOutline[index(x, 0)] = gid(25);
    wallOutline[index(x, height - 1)] = gid(25);
  }
  for (let y = 0; y < height; y++) {
    wallOutline[index(0, y)] = gid(25);
    wallOutline[index(width - 1, y)] = gid(25);
  }
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      if (!wallCells[index(x, y)]) continue;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (!inBounds(nx, ny)) continue;
          const neighborIndex = index(nx, ny);
          if (!wallCells[neighborIndex] && wallOutline[neighborIndex] === 0) {
            wallOutline[neighborIndex] = gid(6);
          }
        }
      }
    }
  }

  const backgroundProperty = [{ name: "Background", type: "bool", value: true }];

  const map = {
    compressionlevel: -1,
    width,
    height,
    infinite: false,
    nextlayerid: 6,
    nextobjectid: 2,
    orientation: "orthogonal",
    renderorder: "right-down",
    tiledversion: "1.10.2",
    tilewidth: TILE_SIZE,
    tileheight: TILE_SIZE,
    type: "map",
    version: "1.10",
    tilesets: [{ firstgid: 1, source: "tilemap_packed.tsx" }],
    layers: [
      {
        data: floor,
        height,
        id: 1,
        name: "Floor",
        opacity: 1,
        properties: backgroundProperty,
        type: "tilelayer",
        visible: true,
        width,
        x: 0,
        y: 0,
      },
      {
        data: wallOutline,
        height,
        id: 2,
        name: "walloutline",
        opacity: 1,
        properties: backgroundProperty,
        type: "tilelayer",
        visible: false,
        width,
        x: 0,
        y: 0,
      },
      {
        data: wall,
        height,
        id: 4,
        name: "wall",
        opacity: 1,
        properties: backgroundProperty,
        type: "tilelayer",
        visible: true,
        width,
        x: 0,
        y: 0,
      },
      {
        data: ceiling,
        height,
        id: 5,
        name: "Ceiling",
        opacity: 0.26,
        type: "tilelayer",
        visible: true,
        width,
        x: 0,
        y: 0,
      },
      {
        draworder: "topdown",
        id: 3,
        name: "Objs",
        opacity: 1,
        type: "objectgroup",
        visible: true,
        x: 0,
        y: 0,
        objects: [
          {
            height: 0,
            id: 1,
            name: "MainSpawnArea",
            rotation: 0,
            type: "SpawnArea",
            visible: true,
            width: 0,
            x: (spawnTileX + 0.5) * TILE_SIZE,
            y: (spawnTileY + 0.5) * TILE_SIZE,
          },
        ],
      },
    ],
  };

  return map as unknown as TiledMap;
}

/** Tiled GIDs are one-based; atlas tile IDs are zero-based. */
function gid(tileId: number): number {
  return tileId + 1;
}

function randomInt(rng: PRNG, min: number, max: number): number {
  if (max < min) return min;
  return min + Math.floor(rng.next() * (max - min + 1));
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
