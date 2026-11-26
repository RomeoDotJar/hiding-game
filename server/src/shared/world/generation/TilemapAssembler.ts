import type { TiledLayer, TiledLayerProperty, TiledMap, TiledObject } from "../TiledMap.js";
import type { MapGenerationConfig } from "./config/MapGenerationConfig.js";
import type { ConnectivityResult } from "./ConnectivityGenerator.js";
import type { GeneratedRoom } from "./types/RoomTypes.js";
import type { TilePoint, TileRect } from "../MapGeometry.js";
import type {
  GeneratedGameplayObject,
  GameplayPlacementResult,
} from "./types/GameplayTypes.js";
import { PRNG } from "../../PRNG.js";
import { autoTileWalls } from "./AutoTiler.js";

const TILE_WIDTH = 8;
const TILE_HEIGHT = 8;
const TILESET_SOURCE = "tilemap_packed.tsx";

/**
 * Atlas-local tile IDs used by the supplied Hub map.
 * Tiled global IDs are produced by adding the tileset firstgid (1).
 *
 * wallMask:
 *   Atlas-local ID 6 = GID 7.
 *   This tile is used as a temporary marker in the walloutline layer.
 *   AutoTiler converts these markers into actual wall variants.
 */
const ATLAS = {
  baseFloor: 14,
  floorAccent: 13,
  rug: 20,
  isolatedMark: 19,
  motifStart: 27,
  ceiling: 30,
  wallMask: 6,
} as const;

export interface TilemapAssemblerInput {
  rooms: readonly GeneratedRoom[];
  connectivity: ConnectivityResult;
  gameplay: GameplayPlacementResult;
}

/**
 * Converts generated room geometry, corridor geometry and gameplay placements
 * into the Hub-compatible Tiled JSON map.
 *
 * Coordinate conventions:
 * - All generation inputs are in integer tile coordinates.
 * - Tiled rectangle objects use pixel-space top-left coordinates.
 * - SpawnArea objects are point objects positioned at the center of a tile.
 * - Door footprints occupy the room-side doorway tiles. Those tiles remain
 *   floor in the static wall layer; closed-door collision is runtime/dynamic.
 *
 * Static collision is represented by the `wall` tile layer.
 * Every cell not belonging to a room or corridor is solid.
 *
 * The `walloutline` layer is used as a temporary binary mask for AutoTiler:
 * - GID 7 identifies a wall cell.
 * - GID 0 identifies a non-wall cell.
 *
 * This class never mutates the supplied rooms, connections or gameplay data.
 */
export class TilemapAssembler {
  private readonly width: number;
  private readonly height: number;
  private readonly rng: PRNG;

  constructor(
    private readonly config: MapGenerationConfig,
    rng: PRNG,
  ) {
    this.width = config.width;
    this.height = config.height;
    this.rng = rng;
    this.validateDimensions();
  }

  public assemble(input: TilemapAssemblerInput): TiledMap {
    const { rooms, connectivity, gameplay } = input;
    const cellCount = this.width * this.height;

    if (rooms.length === 0) {
      throw new Error("TilemapAssembler: at least one room is required.");
    }

    if (connectivity.corridorCells.length !== cellCount) {
      throw new Error(
        `TilemapAssembler: corridorCells must contain ${cellCount} entries; ` +
          `received ${connectivity.corridorCells.length}.`,
      );
    }

    const walkable = new Uint8Array(cellCount);
    const roomOwner = new Int32Array(cellCount);

    // 1. Build walkable room floor from the actual room footprints.
    for (const room of rooms) {
      if (room.footprint.length === 0) {
        throw new Error(
          `TilemapAssembler: room ${room.id} has an empty footprint.`,
        );
      }

      for (const point of room.footprint) {
        this.assertTilePoint(point, `room ${room.id} footprint`);

        const index = this.index(point.x, point.y);

        if (roomOwner[index] !== 0) {
          throw new Error(
            `TilemapAssembler: rooms ${roomOwner[index]} and ${room.id} overlap at ` +
              `(${point.x}, ${point.y}).`,
          );
        }

        roomOwner[index] = room.id;
        walkable[index] = 1;
      }
    }

    // 2. Add corridor floor.
    // The connectivity generator is responsible for carving
    // a width-aware corridor footprint.
    for (let i = 0; i < cellCount; i++) {
      const value = connectivity.corridorCells[i];

      if (value !== 0 && value !== 1) {
        throw new Error(
          `TilemapAssembler: invalid corridorCells value ${value} at index ${i}.`,
        );
      }

      if (value === 0) continue;

      if (walkable[i] !== 0) {
        const x = i % this.width;
        const y = Math.floor(i / this.width);

        throw new Error(
          `TilemapAssembler: corridor overlaps room floor at (${x}, ${y}). ` +
            "Check ConnectivityGenerator corridor carving.",
        );
      }

      walkable[i] = 1;
    }

    // 3. Validate gameplay objects against the walkable map
    // and collect reserved cells so decorations cannot be painted underneath them.
    const roomIds = new Set(rooms.map((room) => room.id));
    const reservedObjectCells = new Set<number>();

    this.validateAndReserveGameplayObjects(
      gameplay.objects,
      roomIds,
      walkable,
      reservedObjectCells,
    );

    // 4. Create floor, wall and wall-mask layers.
    //
    // Floor covers the complete map, following the Hub convention.
    // Solid wall geometry is represented wherever no room/corridor floor exists.
    //
    // The wall layer is initially empty.
    // AutoTiler will populate it using the walloutline mask.
    const floor = new Array<number>(cellCount).fill(gid(ATLAS.baseFloor));

    const wall = new Array<number>(cellCount).fill(0);
    const wallOutline = new Array<number>(cellCount).fill(0);
    const ceiling = new Array<number>(cellCount).fill(0);

    // A solid map boundary is retained.
    // The room/corridor generators already reserve this border.
    // It also prevents actors from walking out of the map.
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        const index = this.index(x, y);

        const boundary =
          x === 0 || y === 0 || x === this.width - 1 || y === this.height - 1;

        if (boundary || walkable[index] === 0) {
          // GID 7 marks this cell as a wall for AutoTiler.
          wallOutline[index] = gid(ATLAS.wallMask);
        }
      }
    }

    // 5. Optional Hub-style floor accents and translucent ceiling overlays.
    if (this.config.decorate) {
      this.decorateRooms(rooms, walkable, reservedObjectCells, floor, ceiling);
    }

    // 6. Convert gameplay placements into the Tiled Objs Object Layer.
    const objects = gameplay.objects
      .slice()
      .sort((a, b) => a.id - b.id)
      .map((object) => this.toTiledObject(object));

    this.assertUniqueTiledObjectIds(objects);

    const backgroundProperty: TiledLayerProperty[] = [
      { name: "Background", type: "bool", value: true },
    ];

    const layers = [
      {
        id: 1,
        name: "Floor",
        type: "tilelayer",
        data: floor,
        width: this.width,
        height: this.height,
        x: 0,
        y: 0,
        opacity: 1,
        visible: true,
        properties: backgroundProperty,
      },
      {
        id: 2,
        name: "walloutline",
        type: "tilelayer",
        data: wallOutline,
        width: this.width,
        height: this.height,
        x: 0,
        y: 0,
        opacity: 1,
        visible: false,
        properties: backgroundProperty,
      },
      {
        id: 4,
        name: "wall",
        type: "tilelayer",
        data: wall,
        width: this.width,
        height: this.height,
        x: 0,
        y: 0,
        opacity: 1,
        visible: true,
        properties: backgroundProperty,
      },
      {
        id: 5,
        name: "Ceiling",
        type: "tilelayer",
        data: ceiling,
        width: this.width,
        height: this.height,
        x: 0,
        y: 0,
        opacity: 0.26,
        visible: true,
      },
      {
        id: 3,
        name: "Objs",
        type: "objectgroup",
        objects,
        x: 0,
        y: 0,
        opacity: 1,
        visible: true,
        draworder: "topdown",
      },
    ] as unknown as TiledLayer[];

    // const maxObjectId = objects.reduce(
    //   (maximum, object) => Math.max(maximum, object.id),
    //   0,
    // );

    // Tiled supports richer root metadata than the project's minimal TiledMap
    // interface. The shape is a standard finite orthogonal TMJ map.
    const map = {
      compressionlevel: -1,
      width: this.width,
      height: this.height,
      infinite: false,
      nextlayerid: 6,
      // nextobjectid: maxObjectId + 1,
      orientation: "orthogonal",
      renderorder: "right-down",
      tiledversion: "1.10.2",
      tilewidth: TILE_WIDTH,
      tileheight: TILE_HEIGHT,
      type: "map",
      version: "1.10",
      tilesets: [
        {
          firstgid: 1,
          source: TILESET_SOURCE,
        },
      ],
      layers,
    };

    // 7. Convert the temporary wall mask into actual wall tiles.
    //
    // AutoTiler reads GID 7 from walloutline, checks cardinal neighbors,
    // and writes the corresponding wall variants into the wall layer.
    //
    // The source walloutline layer is retained in the returned map.
    return autoTileWalls(map as unknown as TiledMap, {
      sourceLayerName: "walloutline",
      targetLayerName: "wall",
      baseWallGid: gid(ATLAS.wallMask),
    });
  }

  private validateDimensions(): void {
    if (!Number.isInteger(this.width) || this.width < 3) {
      throw new Error("TilemapAssembler: width must be an integer >= 3.");
    }

    if (!Number.isInteger(this.height) || this.height < 3) {
      throw new Error("TilemapAssembler: height must be an integer >= 3.");
    }
  }

  private validateAndReserveGameplayObjects(
    objects: readonly GeneratedGameplayObject[],
    roomIds: ReadonlySet<number>,
    walkable: Uint8Array,
    reserved: Set<number>,
  ): void {
    const objectIds = new Set<number>();

    for (const object of objects) {
      if (
        !Number.isInteger(object.id) ||
        object.id <= 0 ||
        objectIds.has(object.id)
      ) {
        throw new Error(
          `TilemapAssembler: invalid or duplicate gameplay object ID ${object.id}.`,
        );
      }

      objectIds.add(object.id);

      if (!roomIds.has(object.roomId)) {
        throw new Error(
          `TilemapAssembler: object ${object.id} references unknown room ${object.roomId}.`,
        );
      }

      this.assertTilePoint(object.position, `object ${object.id} position`);

      const footprint = object.footprint ?? {
        x: object.position.x,
        y: object.position.y,
        width: 1,
        height: 1,
      };

      this.assertTileRect(footprint, `object ${object.id} footprint`);

      for (let y = footprint.y; y < footprint.y + footprint.height; y++) {
        for (let x = footprint.x; x < footprint.x + footprint.width; x++) {
          if (x < 0 || x >= this.width || y < 0 || y >= this.height) {
            throw new Error(
              `TilemapAssembler: object ${object.id} footprint extends outside the map at (${x}, ${y}).`,
            );
          }

          const index = this.index(x, y);

          if (walkable[index] === 0) {
            throw new Error(
              `TilemapAssembler: object ${object.id} (${object.kind}) is not placed on a walkable tile at (${x}, ${y}).`,
            );
          }

          reserved.add(index);
        }
      }
    }
  }

  private toTiledObject(object: GeneratedGameplayObject): TiledObject {
    const footprint = object.footprint ?? {
      x: object.position.x,
      y: object.position.y,
      width: 1,
      height: 1,
    };

    const isSpawn = object.kind === "SpawnArea";

    const topLeftX = footprint.x * TILE_WIDTH;
    const topLeftY = footprint.y * TILE_HEIGHT;

    const properties: Array<{
      name: string;
      type: string;
      value: unknown;
    }> = [
      {
        name: "roomId",
        type: "int",
        value: object.roomId,
      },
      {
        name: "tileX",
        type: "int",
        value: object.position.x,
      },
      {
        name: "tileY",
        type: "int",
        value: object.position.y,
      },
      {
        name: "footprintWidth",
        type: "int",
        value: footprint.width,
      },
      {
        name: "footprintHeight",
        type: "int",
        value: footprint.height,
      },
    ];

    let name = `${object.kind}_${object.id}`;

    switch (object.kind) {
      case "Door":
        properties.push(
          {
            name: "connectionId",
            type: "int",
            value: object.connectionId,
          },
          {
            name: "orientation",
            type: "string",
            value: object.orientation,
          },
          {
            name: "initialState",
            type: "string",
            value: object.initialState,
          },
          {
            name: "hingeTileX",
            type: "int",
            value: object.hinge.x,
          },
          {
            name: "hingeTileY",
            type: "int",
            value: object.hinge.y,
          },
          {
            name: "hingePixelX",
            type: "float",
            value: (object.hinge.x + 0.5) * TILE_WIDTH,
          },
          {
            name: "hingePixelY",
            type: "float",
            value: (object.hinge.y + 0.5) * TILE_HEIGHT,
          },
        );
        break;

      case "Chest":
        properties.push(
          {
            name: "item",
            type: "string",
            value: object.item,
          },
          {
            name: "amount",
            type: "int",
            value: object.amount,
          },
          {
            name: "regionRitualId",
            type: "int",
            value: object.regionRitualId,
          },
        );
        break;

      case "Closet":
        properties.push({
          name: "orientation",
          type: "string",
          value: object.orientation,
        });
        break;

      case "Ritual":
        properties.push(
          {
            name: "ritualId",
            type: "int",
            value: object.ritualId,
          },
          {
            name: "chalkRequired",
            type: "int",
            value: object.chalkRequired,
          },
        );
        break;

      case "SpawnArea":
        properties.push(
          {
            name: "faction",
            type: "string",
            value: object.faction,
          },
          {
            name: "spawnIndex",
            type: "int",
            value: object.spawnIndex,
          },
        );

        name =
          object.faction === "PLAYER" && object.spawnIndex === 0
            ? "MainSpawnArea"
            : `${
                object.faction === "PLAYER" ? "Player" : "Monster"
              }SpawnArea_${object.spawnIndex}`;

        break;
    }

    const tiledObject = {
      id: object.id,
      name,
      type: object.kind,
      x: isSpawn ? (object.position.x + 0.5) * TILE_WIDTH : topLeftX,
      y: isSpawn ? (object.position.y + 0.5) * TILE_HEIGHT : topLeftY,
      width: isSpawn ? 0 : footprint.width * TILE_WIDTH,
      height: isSpawn ? 0 : footprint.height * TILE_HEIGHT,
      rotation: 0,
      visible: true,
      ...(isSpawn ? { point: true } : {}),
      properties,
    };

    return tiledObject as TiledObject;
  }

  private decorateRooms(
    rooms: readonly GeneratedRoom[],
    walkable: Uint8Array,
    reserved: ReadonlySet<number>,
    floor: number[],
    ceiling: number[],
  ): void {
    for (const room of rooms) {
      const roomCells = new Set(
        room.footprint.map((point) => this.index(point.x, point.y)),
      );

      const center = this.getFootprintCenter(room.footprint);

      const paintRoomCell = (x: number, y: number, tileId: number): void => {
        if (x < 0 || x >= this.width || y < 0 || y >= this.height) {
          return;
        }

        const index = this.index(x, y);

        if (
          !roomCells.has(index) ||
          walkable[index] === 0 ||
          reserved.has(index)
        ) {
          return;
        }

        floor[index] = gid(tileId);
      };

      if (room.type === "LARGE" && this.rng.next() < 0.8) {
        // A 3x3 rug-like accent, clipped to the actual room footprint.
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            paintRoomCell(center.x + dx, center.y + dy, ATLAS.rug);
          }
        }
      } else if (room.type === "DEFAULT" && this.rng.next() < 0.5) {
        paintRoomCell(center.x, center.y, ATLAS.floorAccent);

        paintRoomCell(center.x + 1, center.y, ATLAS.floorAccent);
      }

      // An occasional four-tile floor motif, painted only where all cells
      // belong to this room and are not occupied by gameplay objects.
      if (room.footprint.length >= 36 && this.rng.next() < 0.3) {
        const motif = [
          ATLAS.motifStart,
          ATLAS.motifStart + 1,
          ATLAS.motifStart + 1,
          ATLAS.motifStart + 2,
        ];

        const horizontal = this.rng.next() < 0.5;

        const start = this.chooseInteriorStart(
          room.footprint,
          horizontal,
          motif.length,
        );

        if (start) {
          motif.forEach((tileId, offset) => {
            paintRoomCell(
              start.x + (horizontal ? offset : 0),
              start.y + (horizontal ? 0 : offset),
              tileId,
            );
          });
        }
      }

      // Preserve the Hub's translucent ceiling accent on selected rooms.
      if (this.rng.next() < (room.type === "LARGE" ? 0.75 : 0.3)) {
        const ceilingCandidates = room.footprint.filter((point) => {
          const index = this.index(point.x, point.y);

          return walkable[index] !== 0 && !reserved.has(index);
        });

        if (ceilingCandidates.length > 0) {
          const point =
            ceilingCandidates[this.rng.nextInt(0, ceilingCandidates.length)];

          ceiling[this.index(point.x, point.y)] = gid(ATLAS.ceiling);
        }
      }

      // A rare isolated tile-19 mark from the Hub palette.
      if (room.type === "DEFAULT" && this.rng.next() < 0.12) {
        paintRoomCell(center.x, center.y + 2, ATLAS.isolatedMark);
      }
    }
  }

  private getFootprintCenter(footprint: readonly TilePoint[]): TilePoint {
    let meanX = 0;
    let meanY = 0;

    for (const point of footprint) {
      meanX += point.x;
      meanY += point.y;
    }

    meanX /= footprint.length;
    meanY /= footprint.length;

    let closest = footprint[0];
    let bestDistance = Number.POSITIVE_INFINITY;

    for (const point of footprint) {
      const dx = point.x - meanX;
      const dy = point.y - meanY;
      const distance = dx * dx + dy * dy;

      if (distance < bestDistance) {
        bestDistance = distance;
        closest = point;
      }
    }

    return {
      x: closest.x,
      y: closest.y,
    };
  }

  private chooseInteriorStart(
    footprint: readonly TilePoint[],
    horizontal: boolean,
    length: number,
  ): TilePoint | undefined {
    const footprintKeys = new Set(
      footprint.map((point) => this.index(point.x, point.y)),
    );

    const candidates = footprint.filter((point) => {
      for (let offset = 0; offset < length; offset++) {
        const x = point.x + (horizontal ? offset : 0);
        const y = point.y + (horizontal ? 0 : offset);

        if (!footprintKeys.has(this.index(x, y))) {
          return false;
        }
      }

      return true;
    });

    if (candidates.length === 0) {
      return undefined;
    }

    return candidates[this.rng.nextInt(0, candidates.length)];
  }

  private assertTilePoint(point: TilePoint, label: string): void {
    if (!Number.isInteger(point.x) || !Number.isInteger(point.y)) {
      throw new Error(
        `TilemapAssembler: ${label} must use integer tile coordinates.`,
      );
    }

    if (
      point.x < 0 ||
      point.x >= this.width ||
      point.y < 0 ||
      point.y >= this.height
    ) {
      throw new Error(
        `TilemapAssembler: ${label} (${point.x}, ${point.y}) is outside ${this.width}x${this.height}.`,
      );
    }
  }

  private assertTileRect(rect: TileRect, label: string): void {
    if (
      !Number.isInteger(rect.x) ||
      !Number.isInteger(rect.y) ||
      !Number.isInteger(rect.width) ||
      !Number.isInteger(rect.height) ||
      rect.width < 1 ||
      rect.height < 1
    ) {
      throw new Error(
        `TilemapAssembler: ${label} must be an integer rectangle with positive dimensions.`,
      );
    }
  }

  private assertUniqueTiledObjectIds(objects: readonly TiledObject[]): void {
    const ids = new Set<number>();

    for (const object of objects) {
      if (ids.has(object.id)) {
        throw new Error(
          `TilemapAssembler: duplicate Tiled object ID ${object.id}.`,
        );
      }

      ids.add(object.id);
    }
  }

  private index(x: number, y: number): number {
    return y * this.width + x;
  }
}

/** Tiled GIDs are one-based; atlas tile IDs are zero-based. */
function gid(atlasTileId: number): number {
  return atlasTileId + 1;
}
