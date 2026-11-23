import { PRNG } from "../../PRNG.js";
import type { MapGenerationConfig } from "./config/MapGenerationConfig.js";
import type { CardinalDirection, TilePoint } from "./types/MapGeometry.js";
import type { DoorwayAnchor, RoomConnection } from "./types/ConnectionTypes.js";
import type { GeneratedRoom } from "./types/RoomTypes.js";

/**
 * Result of connecting the generated rooms.
 *
 * corridorCells is a flat map-sized grid. A value of 1 marks a corridor-floor
 * tile outside room footprints. Different corridor connections are kept apart
 * by a one-tile Chebyshev clearance so unplanned junctions cannot form.
 */
export interface ConnectivityResult {
  corridorCells: Uint8Array;
  connections: RoomConnection[];
  protectedDeadEndRoomIds: number[];
  adjacency: Map<number, number[]>;
}

interface Direction {
  x: number;
  y: number;
  orientation: CardinalDirection;
}

interface DoorwayCandidate {
  roomId: number;
  /** First room tile in the doorway span, in positive cross-axis order. */
  roomPosition: TilePoint;
  /** First free tile immediately outside the doorway span. */
  outsidePosition: TilePoint;
  orientation: CardinalDirection;
}

interface GraphEdge {
  aIndex: number;
  bIndex: number;
  distance: number;
  tieBreaker: number;
}

interface RoutedConnection {
  path: TilePoint[];
  fromDoorway: DoorwayCandidate;
  toDoorway: DoorwayCandidate;
}

const DIRECTIONS: readonly Direction[] = [
  { x: 1, y: 0, orientation: "EAST" },
  { x: 0, y: 1, orientation: "SOUTH" },
  { x: -1, y: 0, orientation: "WEST" },
  { x: 0, y: -1, orientation: "NORTH" },
];

const MAX_DOORWAY_PAIRS_PER_EDGE = 72;
const MAX_ROUTING_ATTEMPTS = 12;
const NO_PREVIOUS_DIRECTION = 4;

/**
 * Builds a connected room graph and physically carves its corridors.
 *
 * Algorithm:
 * 1. Build a room occupancy grid from actual room footprints.
 * 2. Find doorway spans on each room's real footprint boundary.
 * 3. Build a complete candidate graph weighted by nearest doorway distance.
 * 4. Use a path-aware Kruskal pass to create a minimum-cost feasible spanning
 *    tree. An edge is accepted only when a corridor of the configured width
 *    can actually be routed between its doorway spans.
 * 5. Protect selected MST leaves as dead ends.
 * 6. Optionally add extra room connections and carve their corridors.
 *
 * Coordinates and corridor widths are expressed in tiles. DoorwayAnchor.position
 * is the first room tile of the doorway span; RoomConnection.width defines the
 * span width for both the doorway and its corridor.
 *
 * IMPORTANT: RoomConnection.corridorPath is an anchor path, NOT a geometric
 * centerline. For horizontal segments, width expands toward +Y; for vertical
 * segments, width expands toward +X. Thus each path point identifies the
 * north/west edge of the corresponding width band. Turns are filled in the
 * positive X/Y quadrant. This integer-grid convention also works for even
 * corridor widths, where a tile-centered geometric centerline would be ambiguous.
 */
export class ConnectivityGenerator {
  private readonly width: number;
  private readonly height: number;
  private readonly corridorWidth: number;
  private readonly extraConnectionChance: number;
  private readonly deadEndChance: number;

  /** Room IDs occupy this grid; zero means no room. */
  private roomOwner!: Int32Array;

  /** Previously committed corridor footprint; zero means no corridor. */
  private activeCorridorCells!: Uint8Array;

  /** One-cell Chebyshev clearance between independent corridor footprints. */
  private readonly corridorSeparation = 1;

  /** Corridor routing is kept inside the outermost map border. */
  private readonly interiorMin = 1;
  private readonly interiorMaxX: number;
  private readonly interiorMaxY: number;

  constructor(
    config: MapGenerationConfig,
    private readonly rng: PRNG,
  ) {
    this.width = config.width;
    this.height = config.height;
    this.corridorWidth = config.connectivity.corridorWidth;
    this.extraConnectionChance = config.connectivity.extraConnectionChance;
    this.deadEndChance = config.connectivity.deadEndChance;
    this.interiorMaxX = this.width - 2;
    this.interiorMaxY = this.height - 2;

    this.validateConfiguration();
  }

  /**
   * Connects all supplied rooms and returns the carved corridor grid,
   * generated RoomConnections and a convenient adjacency map.
   *
   * A single-room map is valid and produces an empty connection graph.
   */
  public generate(rooms: readonly GeneratedRoom[]): ConnectivityResult {
    let lastRoutingError: RoutingAttemptError | undefined;

    // A greedy route can occasionally block a later MST edge. A fresh attempt
    // consumes a new deterministic segment of the seeded PRNG, changing edge
    // tie-breaks and BFS direction order while preserving reproducibility.
    for (let attempt = 1; attempt <= MAX_ROUTING_ATTEMPTS; attempt++) {
      try {
        return this.generateAttempt(rooms);
      } catch (error) {
        if (!(error instanceof RoutingAttemptError)) throw error;
        lastRoutingError = error;
      }
    }

    throw new Error(
      `ConnectivityGenerator: unable to route a connected room graph after ${MAX_ROUTING_ATTEMPTS} deterministic attempts. ` +
        (lastRoutingError?.message ?? "No routing details available."),
    );
  }

  private generateAttempt(rooms: readonly GeneratedRoom[]): ConnectivityResult {
    if (rooms.length === 0) {
      throw new Error("ConnectivityGenerator: at least one room is required.");
    }

    this.roomOwner = this.buildRoomOwnerGrid(rooms);

    const corridorCells = new Uint8Array(this.width * this.height);
    this.activeCorridorCells = corridorCells;
    const adjacency = new Map<number, number[]>();
    for (const room of rooms) adjacency.set(room.id, []);

    if (rooms.length === 1) {
      return {
        corridorCells,
        connections: [],
        protectedDeadEndRoomIds: [],
        adjacency,
      };
    }

    const doorwaysByRoom = new Map<number, DoorwayCandidate[]>();
    for (const room of rooms) {
      const candidates = this.findDoorwayCandidates(room);
      if (candidates.length === 0) {
        throw new Error(
          `ConnectivityGenerator: room ${room.id} (${room.templateId}) has no ` +
            `doorway span wide enough for a ${this.corridorWidth}-tile corridor. ` +
            "Reduce corridorWidth or use a larger room template.",
        );
      }
      doorwaysByRoom.set(room.id, candidates);
    }

    const edges = this.createCandidateEdges(rooms, doorwaysByRoom);
    const disjointSet = new DisjointSet(rooms.map((room) => room.id));
    const treeEdges = new Set<string>();
    const treeDegree = new Map<number, number>();
    for (const room of rooms) treeDegree.set(room.id, 0);

    const connections: RoomConnection[] = [];
    let nextConnectionId = 1;

    // Path-aware Kruskal: edges are considered in increasing estimated length,
    // but an edge is accepted only after a valid width-aware corridor is found.
    for (const edge of edges) {
      const roomA = rooms[edge.aIndex];
      const roomB = rooms[edge.bIndex];
      if (disjointSet.find(roomA.id) === disjointSet.find(roomB.id)) continue;

      const route = this.tryRouteBetweenRooms(
        roomA,
        roomB,
        doorwaysByRoom,
        corridorCells,
      );
      if (!route) continue;

      disjointSet.union(roomA.id, roomB.id);
      treeEdges.add(edgeKey(roomA.id, roomB.id));
      treeDegree.set(roomA.id, (treeDegree.get(roomA.id) ?? 0) + 1);
      treeDegree.set(roomB.id, (treeDegree.get(roomB.id) ?? 0) + 1);

      const connection = this.createConnection(
        nextConnectionId++,
        roomA,
        roomB,
        route,
        "TREE",
      );
      connections.push(connection);
      this.addAdjacency(adjacency, roomA.id, roomB.id);

      if (connections.length === rooms.length - 1) break;
    }

    if (connections.length !== rooms.length - 1) {
      const components = disjointSet.getComponents();
      throw new RoutingAttemptError(
        "A connected room graph could not be carved. " +
          `Connected ${disjointSet.componentCount} of ${rooms.length} components. ` +
          `corridorWidth=${this.corridorWidth}, map=${this.width}x${this.height}. ` +
          `Remaining components: ${components.map((component) => `[${component.join(", ")}]`).join(" ")}. ` +
          "Try increasing map dimensions, reducing roomsCount or room sizes, " +
          "reducing minRoomSpacing, or reducing corridorWidth.",
      );
    }

    // Selected leaves of the spanning tree are protected from additional edges.
    const protectedDeadEndRoomIds: number[] = [];
    const protectedDeadEndSet = new Set<number>();
    for (const room of rooms) {
      if (
        treeDegree.get(room.id) === 1 &&
        this.rng.next() < this.deadEndChance
      ) {
        protectedDeadEndSet.add(room.id);
        protectedDeadEndRoomIds.push(room.id);
      }
    }

    // Additional connections introduce loops and alternative chase routes.
    for (const edge of edges) {
      const roomA = rooms[edge.aIndex];
      const roomB = rooms[edge.bIndex];
      if (treeEdges.has(edgeKey(roomA.id, roomB.id))) continue;
      if (
        protectedDeadEndSet.has(roomA.id) ||
        protectedDeadEndSet.has(roomB.id)
      ) {
        continue;
      }
      if (this.rng.next() >= this.extraConnectionChance) continue;

      const route = this.tryRouteBetweenRooms(
        roomA,
        roomB,
        doorwaysByRoom,
        corridorCells,
      );
      // Extra connections are optional. An unroutable extra edge is skipped;
      // the already-established spanning tree remains valid.
      if (!route) continue;

      const connection = this.createConnection(
        nextConnectionId++,
        roomA,
        roomB,
        route,
        "EXTRA",
      );
      connections.push(connection);
      this.addAdjacency(adjacency, roomA.id, roomB.id);
    }

    return {
      corridorCells,
      connections,
      protectedDeadEndRoomIds,
      adjacency,
    };
  }

  private validateConfiguration(): void {
    if (!Number.isInteger(this.width) || this.width < 3) {
      throw new Error("ConnectivityGenerator: width must be an integer >= 3.");
    }
    if (!Number.isInteger(this.height) || this.height < 3) {
      throw new Error("ConnectivityGenerator: height must be an integer >= 3.");
    }
    if (!Number.isInteger(this.corridorWidth) || this.corridorWidth < 1) {
      throw new Error(
        "ConnectivityGenerator: corridorWidth must be a positive integer.",
      );
    }
    if (
      !Number.isFinite(this.extraConnectionChance) ||
      this.extraConnectionChance < 0 ||
      this.extraConnectionChance > 1
    ) {
      throw new Error(
        "ConnectivityGenerator: extraConnectionChance must be between 0 and 1.",
      );
    }
    if (
      !Number.isFinite(this.deadEndChance) ||
      this.deadEndChance < 0 ||
      this.deadEndChance > 1
    ) {
      throw new Error(
        "ConnectivityGenerator: deadEndChance must be between 0 and 1.",
      );
    }
  }

  private buildRoomOwnerGrid(rooms: readonly GeneratedRoom[]): Int32Array {
    const owner = new Int32Array(this.width * this.height);
    const ids = new Set<number>();

    for (const room of rooms) {
      if (!Number.isInteger(room.id) || room.id <= 0 || ids.has(room.id)) {
        throw new Error(
          `ConnectivityGenerator: room IDs must be unique positive integers (invalid ID ${room.id}).`,
        );
      }
      ids.add(room.id);

      if (room.footprint.length === 0) {
        throw new Error(
          `ConnectivityGenerator: room ${room.id} has an empty footprint.`,
        );
      }

      const localPoints = new Set<number>();
      for (const point of room.footprint) {
        if (
          !Number.isInteger(point.x) ||
          !Number.isInteger(point.y) ||
          point.x < this.interiorMin ||
          point.x > this.interiorMaxX ||
          point.y < this.interiorMin ||
          point.y > this.interiorMaxY
        ) {
          throw new Error(
            `ConnectivityGenerator: room ${room.id} contains an out-of-bounds ` +
              `or non-integer footprint tile (${point.x}, ${point.y}). ` +
              "Rooms must leave the outermost map border clear for walls.",
          );
        }

        const cellIndex = this.index(point.x, point.y);
        if (localPoints.has(cellIndex)) {
          throw new Error(
            `ConnectivityGenerator: room ${room.id} contains duplicate footprint tile (${point.x}, ${point.y}).`,
          );
        }
        localPoints.add(cellIndex);

        if (owner[cellIndex] !== 0) {
          throw new Error(
            `ConnectivityGenerator: rooms ${owner[cellIndex]} and ${room.id} overlap at (${point.x}, ${point.y}).`,
          );
        }
        owner[cellIndex] = room.id;
      }
    }

    return owner;
  }

  /**
   * Finds every contiguous doorway span on the actual room footprint.
   * For NORTH/SOUTH doors the span grows toward +X; for EAST/WEST doors it
   * grows toward +Y. This convention makes an even-width opening unambiguous.
   */
  private findDoorwayCandidates(room: GeneratedRoom): DoorwayCandidate[] {
    const candidates: DoorwayCandidate[] = [];
    const seen = new Set<string>();

    for (const roomTile of room.footprint) {
      for (
        let directionIndex = 0;
        directionIndex < DIRECTIONS.length;
        directionIndex++
      ) {
        const direction = DIRECTIONS[directionIndex];
        const cross = this.getCrossAxis(directionIndex);
        let validSpan = true;

        for (let offset = 0; offset < this.corridorWidth; offset++) {
          const roomX = roomTile.x + cross.x * offset;
          const roomY = roomTile.y + cross.y * offset;
          const outsideX = roomX + direction.x;
          const outsideY = roomY + direction.y;

          if (
            !this.isRoutingInterior(outsideX, outsideY) ||
            this.roomOwner[this.index(roomX, roomY)] !== room.id ||
            this.roomOwner[this.index(outsideX, outsideY)] !== 0
          ) {
            validSpan = false;
            break;
          }
        }

        if (!validSpan) continue;

        const key = `${roomTile.x}:${roomTile.y}:${direction.orientation}`;
        if (seen.has(key)) continue;
        seen.add(key);

        candidates.push({
          roomId: room.id,
          roomPosition: { x: roomTile.x, y: roomTile.y },
          outsidePosition: {
            x: roomTile.x + direction.x,
            y: roomTile.y + direction.y,
          },
          orientation: direction.orientation,
        });
      }
    }

    return candidates;
  }

  private createCandidateEdges(
    rooms: readonly GeneratedRoom[],
    doorwaysByRoom: ReadonlyMap<number, DoorwayCandidate[]>,
  ): GraphEdge[] {
    const edges: GraphEdge[] = [];

    for (let aIndex = 0; aIndex < rooms.length; aIndex++) {
      for (let bIndex = aIndex + 1; bIndex < rooms.length; bIndex++) {
        const a = doorwaysByRoom.get(rooms[aIndex].id) ?? [];
        const b = doorwaysByRoom.get(rooms[bIndex].id) ?? [];
        let minimumDistance = Number.POSITIVE_INFINITY;

        for (const from of a) {
          for (const to of b) {
            minimumDistance = Math.min(
              minimumDistance,
              manhattan(from.outsidePosition, to.outsidePosition),
            );
          }
        }

        if (!Number.isFinite(minimumDistance)) continue;

        edges.push({
          aIndex,
          bIndex,
          distance: minimumDistance,
          tieBreaker: this.rng.next(),
        });
      }
    }

    edges.sort(
      (left, right) =>
        left.distance - right.distance ||
        left.tieBreaker - right.tieBreaker ||
        left.aIndex - right.aIndex ||
        left.bIndex - right.bIndex,
    );

    return edges;
  }

  private tryRouteBetweenRooms(
    fromRoom: GeneratedRoom,
    toRoom: GeneratedRoom,
    doorwaysByRoom: ReadonlyMap<number, DoorwayCandidate[]>,
    corridorCells: Uint8Array,
  ): RoutedConnection | undefined {
    const fromDoorways = doorwaysByRoom.get(fromRoom.id) ?? [];
    const toDoorways = doorwaysByRoom.get(toRoom.id) ?? [];

    const pairs: Array<{
      from: DoorwayCandidate;
      to: DoorwayCandidate;
      distance: number;
      tieBreaker: number;
    }> = [];

    for (const from of fromDoorways) {
      for (const to of toDoorways) {
        pairs.push({
          from,
          to,
          distance: manhattan(from.outsidePosition, to.outsidePosition),
          tieBreaker: this.rng.next(),
        });
      }
    }

    pairs.sort(
      (left, right) =>
        left.distance - right.distance || left.tieBreaker - right.tieBreaker,
    );

    const attemptCount = Math.min(pairs.length, MAX_DOORWAY_PAIRS_PER_EDGE);

    for (let i = 0; i < attemptCount; i++) {
      const pair = pairs[i];
      const path = this.findWidthAwarePath(pair.from, pair.to);
      if (!path) continue;

      const corridorFootprint = this.buildCorridorFootprint(
        path,
        pair.from.orientation,
      );

      // Recheck the complete corridor footprint before reserving any cells.
      if (!this.canCarveCells(corridorFootprint)) continue;

      for (const point of corridorFootprint) {
        corridorCells[this.index(point.x, point.y)] = 1;
      }

      return {
        path,
        fromDoorway: pair.from,
        toDoorway: pair.to,
      };
    }

    return undefined;
  }

  /**
   * BFS over (tile, incoming direction) states. Every transition is checked
   * against the full corridor-width footprint, so a path is never accepted
   * merely because its one-tile centreline fits.
   */
  private findWidthAwarePath(
    from: DoorwayCandidate,
    to: DoorwayCandidate,
  ): TilePoint[] | undefined {
    const startIndex = this.index(
      from.outsidePosition.x,
      from.outsidePosition.y,
    );
    const goalIndex = this.index(to.outsidePosition.x, to.outsidePosition.y);
    const startDirection = directionIndex(from.orientation);
    const requiredFinalDirection = oppositeDirection(
      directionIndex(to.orientation),
    );

    // Two rooms separated by a single free tile can connect directly when the
    // configured corridor is one tile wide and their doors face one another.
    if (startIndex === goalIndex) {
      if (
        this.corridorWidth === 1 &&
        startDirection === requiredFinalDirection &&
        this.isRoutingInterior(
          from.outsidePosition.x,
          from.outsidePosition.y,
        ) &&
        this.roomOwner[startIndex] === 0
      ) {
        return [{ ...from.outsidePosition }];
      }
      return undefined;
    }

    const cellCount = this.width * this.height;
    const statesPerCell = 5;
    const previousState = new Int32Array(cellCount * statesPerCell);
    previousState.fill(-1);
    const queue = new Int32Array(cellCount * statesPerCell);

    const startState = startIndex * statesPerCell + NO_PREVIOUS_DIRECTION;
    previousState[startState] = -2;

    let head = 0;
    let tail = 0;
    queue[tail++] = startState;

    const rotation = this.rng.nextInt(0, DIRECTIONS.length);
    const directionOrder = DIRECTIONS.map(
      (_, index) => (index + rotation) % DIRECTIONS.length,
    );

    let finalState = -1;

    while (head < tail) {
      const currentState = queue[head++];
      const currentCell = Math.floor(currentState / statesPerCell);
      const previousDirection = currentState % statesPerCell;
      const current: TilePoint = {
        x: currentCell % this.width,
        y: Math.floor(currentCell / this.width),
      };

      const candidateDirections =
        previousDirection === NO_PREVIOUS_DIRECTION
          ? [startDirection]
          : directionOrder;

      for (const nextDirection of candidateDirections) {
        if (
          previousDirection !== NO_PREVIOUS_DIRECTION &&
          nextDirection === oppositeDirection(previousDirection)
        ) {
          continue;
        }

        const vector = DIRECTIONS[nextDirection];
        const next: TilePoint = {
          x: current.x + vector.x,
          y: current.y + vector.y,
        };

        if (!this.isRoutingInterior(next.x, next.y)) continue;

        const nextCell = this.index(next.x, next.y);
        if (
          nextCell === goalIndex &&
          nextDirection !== requiredFinalDirection
        ) {
          continue;
        }

        if (
          !this.canCarveTransition(
            current,
            next,
            previousDirection,
            nextDirection,
          )
        ) {
          continue;
        }

        const nextState = nextCell * statesPerCell + nextDirection;
        if (previousState[nextState] !== -1) continue;

        previousState[nextState] = currentState;
        queue[tail++] = nextState;

        if (nextCell === goalIndex) {
          finalState = nextState;
          break;
        }
      }

      if (finalState !== -1) break;
    }

    if (finalState === -1) return undefined;

    const reversedPath: TilePoint[] = [];
    let state = finalState;

    while (state >= 0) {
      const cellIndex = Math.floor(state / statesPerCell);
      reversedPath.push({
        x: cellIndex % this.width,
        y: Math.floor(cellIndex / this.width),
      });

      const previous = previousState[state];
      if (previous === -2) break;
      state = previous;
    }

    reversedPath.reverse();
    return reversedPath;
  }

  private canCarveTransition(
    current: TilePoint,
    next: TilePoint,
    previousDirection: number,
    nextDirection: number,
  ): boolean {
    const cells: TilePoint[] = [];
    const direction = DIRECTIONS[nextDirection];
    const width = this.corridorWidth;

    // Add the full-width strip covering this one-tile movement.
    if (direction.x !== 0) {
      for (let offset = 0; offset < width; offset++) {
        cells.push({ x: current.x, y: current.y + offset });
        cells.push({ x: next.x, y: next.y + offset });
      }
    } else {
      for (let offset = 0; offset < width; offset++) {
        cells.push({ x: current.x + offset, y: current.y });
        cells.push({ x: next.x + offset, y: next.y });
      }
    }

    // Fill the inside of a turn to prevent diagonal pinholes.
    if (
      previousDirection !== NO_PREVIOUS_DIRECTION &&
      isPerpendicular(previousDirection, nextDirection)
    ) {
      this.addCornerSquare(current, cells);
    }

    return this.canCarveCells(cells);
  }

  private buildCorridorFootprint(
    path: readonly TilePoint[],
    startOrientation: CardinalDirection,
  ): TilePoint[] {
    const result = new Map<number, TilePoint>();

    const add = (point: TilePoint): void => {
      result.set(this.index(point.x, point.y), point);
    };

    if (path.length === 1) {
      const cross = this.getCrossAxis(directionIndex(startOrientation));
      for (let offset = 0; offset < this.corridorWidth; offset++) {
        add({
          x: path[0].x + cross.x * offset,
          y: path[0].y + cross.y * offset,
        });
      }
      return [...result.values()];
    }

    for (let i = 0; i < path.length - 1; i++) {
      const current = path[i];
      const next = path[i + 1];
      const direction = directionBetween(current, next);
      const vector = DIRECTIONS[direction];

      if (vector.x !== 0) {
        for (let offset = 0; offset < this.corridorWidth; offset++) {
          add({ x: current.x, y: current.y + offset });
          add({ x: next.x, y: next.y + offset });
        }
      } else {
        for (let offset = 0; offset < this.corridorWidth; offset++) {
          add({ x: current.x + offset, y: current.y });
          add({ x: next.x + offset, y: next.y });
        }
      }

      if (i > 0) {
        const previousDirection = directionBetween(path[i - 1], current);
        if (isPerpendicular(previousDirection, direction)) {
          const cornerCells: TilePoint[] = [];
          this.addCornerSquare(current, cornerCells);
          for (const point of cornerCells) add(point);
        }
      }
    }

    return [...result.values()];
  }

  private addCornerSquare(origin: TilePoint, output: TilePoint[]): void {
    for (let dy = 0; dy < this.corridorWidth; dy++) {
      for (let dx = 0; dx < this.corridorWidth; dx++) {
        output.push({ x: origin.x + dx, y: origin.y + dy });
      }
    }
  }

  /**
   * Rejects cells that would overlap a room, overlap a previous corridor,
   * or touch one diagonally/cardinally. A one-cell Chebyshev halo preserves
   * at least one solid tile between independent corridor footprints, so no
   * unplanned floor junction can appear outside a room.
   */
  private canCarveCells(cells: readonly TilePoint[]): boolean {
    for (const point of cells) {
      if (!this.isRoutingInterior(point.x, point.y)) return false;
      if (this.roomOwner[this.index(point.x, point.y)] !== 0) return false;

      for (
        let dy = -this.corridorSeparation;
        dy <= this.corridorSeparation;
        dy++
      ) {
        for (
          let dx = -this.corridorSeparation;
          dx <= this.corridorSeparation;
          dx++
        ) {
          const nx = point.x + dx;
          const ny = point.y + dy;
          if (!this.isRoutingInterior(nx, ny)) continue;

          if (this.activeCorridorCells[this.index(nx, ny)] !== 0) {
            return false;
          }
        }
      }
    }

    return true;
  }

  private createConnection(
    id: number,
    fromRoom: GeneratedRoom,
    toRoom: GeneratedRoom,
    route: RoutedConnection,
    type: "TREE" | "EXTRA",
  ): RoomConnection {
    const fromDoorway: DoorwayAnchor = {
      roomId: fromRoom.id,
      position: { ...route.fromDoorway.roomPosition },
      orientation: route.fromDoorway.orientation,
    };

    const toDoorway: DoorwayAnchor = {
      roomId: toRoom.id,
      position: { ...route.toDoorway.roomPosition },
      orientation: route.toDoorway.orientation,
    };

    return {
      id,
      fromRoomId: fromRoom.id,
      toRoomId: toRoom.id,
      type,
      corridorPath: route.path,
      width: this.corridorWidth,
      doorways: [fromDoorway, toDoorway],
    };
  }

  private addAdjacency(
    adjacency: Map<number, number[]>,
    a: number,
    b: number,
  ): void {
    adjacency.get(a)?.push(b);
    adjacency.get(b)?.push(a);
  }

  private getCrossAxis(directionIndex: number): TilePoint {
    // NORTH/SOUTH door spans are horizontal; EAST/WEST spans are vertical.
    return directionIndex === 0 || directionIndex === 2
      ? { x: 0, y: 1 }
      : { x: 1, y: 0 };
  }

  private isRoutingInterior(x: number, y: number): boolean {
    return (
      x >= this.interiorMin &&
      x <= this.interiorMaxX &&
      y >= this.interiorMin &&
      y <= this.interiorMaxY
    );
  }

  private index(x: number, y: number): number {
    return y * this.width + x;
  }
}

/** Internal error indicating that a different deterministic routing pass may succeed. */
class RoutingAttemptError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RoutingAttemptError";
  }
}

/** Disjoint-set union with path compression and union by rank. */
class DisjointSet {
  private readonly parent = new Map<number, number>();
  private readonly rank = new Map<number, number>();
  componentCount: number;

  constructor(values: readonly number[]) {
    this.componentCount = values.length;
    for (const value of values) {
      this.parent.set(value, value);
      this.rank.set(value, 0);
    }
  }

  find(value: number): number {
    const parent = this.parent.get(value);
    if (parent === undefined) {
      throw new Error(`DisjointSet: unknown room ID ${value}.`);
    }
    if (parent !== value) {
      const root = this.find(parent);
      this.parent.set(value, root);
      return root;
    }
    return value;
  }

  union(a: number, b: number): boolean {
    let rootA = this.find(a);
    let rootB = this.find(b);
    if (rootA === rootB) return false;

    const rankA = this.rank.get(rootA) ?? 0;
    const rankB = this.rank.get(rootB) ?? 0;

    if (rankA < rankB) [rootA, rootB] = [rootB, rootA];

    this.parent.set(rootB, rootA);
    if (rankA === rankB) this.rank.set(rootA, rankA + 1);

    this.componentCount--;
    return true;
  }

  getComponents(): number[][] {
    const groups = new Map<number, number[]>();
    for (const value of this.parent.keys()) {
      const root = this.find(value);
      const group = groups.get(root) ?? [];
      group.push(value);
      groups.set(root, group);
    }
    return [...groups.values()].map((group) => group.sort((a, b) => a - b));
  }
}

function directionIndex(direction: CardinalDirection): number {
  switch (direction) {
    case "EAST":
      return 0;
    case "SOUTH":
      return 1;
    case "WEST":
      return 2;
    case "NORTH":
      return 3;
  }
}

function oppositeDirection(direction: number): number {
  return (direction + 2) % 4;
}

function isPerpendicular(a: number, b: number): boolean {
  return a % 2 !== b % 2;
}

function directionBetween(a: TilePoint, b: TilePoint): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (dx === 1 && dy === 0) return 0;
  if (dx === 0 && dy === 1) return 1;
  if (dx === -1 && dy === 0) return 2;
  if (dx === 0 && dy === -1) return 3;
  throw new Error(
    `ConnectivityGenerator: non-cardinal path step (${a.x},${a.y}) -> (${b.x},${b.y}).`,
  );
}

function edgeKey(a: number, b: number): string {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

function manhattan(a: TilePoint, b: TilePoint): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}
