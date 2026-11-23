import type { RoomConnection } from "../types/ConnectionTypes.js";
import type { GeneratedRoom } from "../types/RoomTypes.js";

/**
 * A route through the logical room graph.
 *
 * roomIds contains both endpoints. connections[i] connects
 * roomIds[i] to roomIds[i + 1].
 */
export interface RoomGraphPath {
  roomIds: number[];
  connections: RoomConnection[];
  /** Sum of corridorPath.length for every connection, measured in tiles. */
  distance: number;
}

interface PreviousStep {
  roomId: number;
  connection: RoomConnection;
}

/**
 * Read-only query facade over generated rooms and RoomConnections.
 *
 * ConnectivityGenerator remains responsible for constructing and carving
 * corridors. RoomGraph derives adjacency from the returned connections and
 * exposes reusable graph queries for gameplay placement and AI navigation.
 *
 * Distances:
 * - getDistance(): minimum number of room-to-room connections (BFS hops).
 * - getShortestPathLength(): minimum sum of corridor anchor-path tile counts
 *   (Dijkstra). See the corridorPath convention in ConnectionTypes.ts.
 *
 * Unknown room IDs throw. A valid but disconnected pair returns Infinity from
 * distance methods and undefined from path methods.
 */
export class RoomGraph {
  private readonly roomsById = new Map<number, GeneratedRoom>();
  private readonly connectionsById = new Map<number, RoomConnection>();
  private readonly neighborsByRoom = new Map<number, number[]>();
  private readonly incidentByRoom = new Map<number, RoomConnection[]>();

  constructor(
    rooms: readonly GeneratedRoom[],
    connections: readonly RoomConnection[],
  ) {
    if (rooms.length === 0) {
      throw new Error("RoomGraph: at least one room is required.");
    }

    this.indexRooms(rooms);
    this.indexConnections(connections);
    this.sortIndexes();
  }

  /** Returns a room by ID. Throws if the ID is unknown. */
  public getRoom(roomId: number): GeneratedRoom {
    this.assertRoomExists(roomId);
    return this.roomsById.get(roomId)!;
  }

  /** Returns all rooms sorted by ID. */
  public getRooms(): GeneratedRoom[] {
    return [...this.roomsById.values()].sort((a, b) => a.id - b.id);
  }

  /** Returns unique directly connected room IDs, sorted ascending. */
  public getNeighbors(roomId: number): number[] {
    this.assertRoomExists(roomId);
    return [...(this.neighborsByRoom.get(roomId) ?? [])];
  }

  /** Returns every connection incident to a room, sorted by connection ID. */
  public getConnections(roomId: number): RoomConnection[] {
    this.assertRoomExists(roomId);
    return [...(this.incidentByRoom.get(roomId) ?? [])];
  }

  /** Returns a connection by ID. Throws if the ID is unknown. */
  public getConnection(connectionId: number): RoomConnection {
    const connection = this.connectionsById.get(connectionId);
    if (!connection) {
      throw new Error(`RoomGraph: unknown connection ID ${connectionId}.`);
    }
    return connection;
  }

  /** Number of incident connections. */
  public getRoomDegree(roomId: number): number {
    this.assertRoomExists(roomId);
    return this.incidentByRoom.get(roomId)?.length ?? 0;
  }

  /**
   * Returns the minimum number of graph edges between two rooms.
   * Returns 0 for the same room and Infinity when no route exists.
   */
  public getDistance(fromRoomId: number, toRoomId: number): number {
    const path = this.findShortestPath(fromRoomId, toRoomId);
    return path ? path.length - 1 : Number.POSITIVE_INFINITY;
  }

  /**
   * Finds a path with the fewest room-to-room connections using BFS.
   * The returned array contains room IDs, including both endpoints.
   */
  public findShortestPath(
    fromRoomId: number,
    toRoomId: number,
  ): number[] | undefined {
    this.assertRoomExists(fromRoomId);
    this.assertRoomExists(toRoomId);

    if (fromRoomId === toRoomId) return [fromRoomId];

    const queue: number[] = [fromRoomId];
    let head = 0;
    const visited = new Set<number>([fromRoomId]);
    const previous = new Map<number, number>();

    while (head < queue.length) {
      const current = queue[head++];

      for (const neighbor of this.neighborsByRoom.get(current) ?? []) {
        if (visited.has(neighbor)) continue;

        visited.add(neighbor);
        previous.set(neighbor, current);

        if (neighbor === toRoomId) {
          return reconstructRoomPath(previous, fromRoomId, toRoomId);
        }

        queue.push(neighbor);
      }
    }

    return undefined;
  }

  /**
   * Returns the actual RoomConnection sequence for a minimum-hop route.
   * If parallel connections exist, the lowest connection ID is preferred.
   */
  public findShortestPathConnections(
    fromRoomId: number,
    toRoomId: number,
  ): RoomConnection[] | undefined {
    this.assertRoomExists(fromRoomId);
    this.assertRoomExists(toRoomId);

    if (fromRoomId === toRoomId) return [];

    const queue: number[] = [fromRoomId];
    let head = 0;
    const visited = new Set<number>([fromRoomId]);
    const previous = new Map<number, PreviousStep>();

    while (head < queue.length) {
      const current = queue[head++];
      for (const connection of this.incidentByRoom.get(current) ?? []) {
        const neighbor = otherEndpoint(connection, current);
        if (visited.has(neighbor)) continue;

        visited.add(neighbor);
        previous.set(neighbor, { roomId: current, connection });

        if (neighbor === toRoomId) {
          return reconstructConnectionPath(previous, fromRoomId, toRoomId);
        }

        queue.push(neighbor);
      }
    }

    return undefined;
  }

  /**
   * Finds the route with the lowest corridor-length cost using Dijkstra.
   * Each connection cost is corridorPath.length, with a minimum cost of 1.
   */
  public findLowestCostPath(
    fromRoomId: number,
    toRoomId: number,
  ): RoomGraphPath | undefined {
    this.assertRoomExists(fromRoomId);
    this.assertRoomExists(toRoomId);

    if (fromRoomId === toRoomId) {
      return { roomIds: [fromRoomId], connections: [], distance: 0 };
    }

    const distances = new Map<number, number>();
    const previous = new Map<number, PreviousStep>();
    const unvisited = new Set<number>(this.roomsById.keys());

    for (const roomId of unvisited)
      distances.set(roomId, Number.POSITIVE_INFINITY);
    distances.set(fromRoomId, 0);

    while (unvisited.size > 0) {
      const current = this.findLowestDistanceRoom(unvisited, distances);
      if (current === undefined) break;

      const currentDistance = distances.get(current)!;
      if (!Number.isFinite(currentDistance)) break;
      unvisited.delete(current);

      if (current === toRoomId) break;

      for (const connection of this.incidentByRoom.get(current) ?? []) {
        const neighbor = otherEndpoint(connection, current);
        if (!unvisited.has(neighbor)) continue;

        const candidateDistance =
          currentDistance + getConnectionCost(connection);
        const knownDistance = distances.get(neighbor)!;
        const previousStep = previous.get(neighbor);

        if (
          candidateDistance < knownDistance ||
          (candidateDistance === knownDistance &&
            connection.id <
              (previousStep?.connection.id ?? Number.POSITIVE_INFINITY))
        ) {
          distances.set(neighbor, candidateDistance);
          previous.set(neighbor, { roomId: current, connection });
        }
      }
    }

    const distance = distances.get(toRoomId) ?? Number.POSITIVE_INFINITY;
    if (!Number.isFinite(distance)) return undefined;

    const roomIds: number[] = [toRoomId];
    const pathConnections: RoomConnection[] = [];
    let current = toRoomId;

    while (current !== fromRoomId) {
      const step = previous.get(current);
      if (!step) {
        throw new Error("RoomGraph: failed to reconstruct a Dijkstra path.");
      }
      pathConnections.push(step.connection);
      current = step.roomId;
      roomIds.push(current);
    }

    roomIds.reverse();
    pathConnections.reverse();

    return {
      roomIds,
      connections: pathConnections,
      distance,
    };
  }

  /** Returns the lowest corridor-length path cost, or Infinity if disconnected. */
  public getShortestPathLength(fromRoomId: number, toRoomId: number): number {
    return (
      this.findLowestCostPath(fromRoomId, toRoomId)?.distance ??
      Number.POSITIVE_INFINITY
    );
  }

  /** Returns all connected components as arrays of sorted room IDs. */
  public getConnectedComponents(): number[][] {
    const visited = new Set<number>();
    const components: number[][] = [];

    for (const roomId of [...this.roomsById.keys()].sort((a, b) => a - b)) {
      if (visited.has(roomId)) continue;

      const component: number[] = [];
      const queue = [roomId];
      visited.add(roomId);
      let head = 0;

      while (head < queue.length) {
        const current = queue[head++];
        component.push(current);

        for (const neighbor of this.neighborsByRoom.get(current) ?? []) {
          if (visited.has(neighbor)) continue;
          visited.add(neighbor);
          queue.push(neighbor);
        }
      }

      component.sort((a, b) => a - b);
      components.push(component);
    }

    return components;
  }

  /** True when the graph consists of exactly one connected component. */
  public isConnected(): boolean {
    return this.getConnectedComponents().length === 1;
  }

  /** Returns room IDs with exactly one incident connection. */
  public getDeadEnds(): number[] {
    return this.getRooms()
      .filter((room) => this.getRoomDegree(room.id) === 1)
      .map((room) => room.id);
  }

  /** Returns room IDs with no incident connections. */
  public getIsolatedRooms(): number[] {
    return this.getRooms()
      .filter((room) => this.getRoomDegree(room.id) === 0)
      .map((room) => room.id);
  }

  /** Returns the graph's total number of room connections. */
  public getConnectionCount(): number {
    return this.connectionsById.size;
  }

  private indexRooms(rooms: readonly GeneratedRoom[]): void {
    for (const room of rooms) {
      if (!Number.isInteger(room.id) || room.id <= 0) {
        throw new Error(
          `RoomGraph: room IDs must be positive integers; received ${room.id}.`,
        );
      }
      if (this.roomsById.has(room.id)) {
        throw new Error(`RoomGraph: duplicate room ID ${room.id}.`);
      }

      this.roomsById.set(room.id, room);
      this.neighborsByRoom.set(room.id, []);
      this.incidentByRoom.set(room.id, []);
    }
  }

  private indexConnections(connections: readonly RoomConnection[]): void {
    for (const connection of connections) {
      if (!Number.isInteger(connection.id) || connection.id <= 0) {
        throw new Error(
          `RoomGraph: connection IDs must be positive integers; received ${connection.id}.`,
        );
      }
      if (this.connectionsById.has(connection.id)) {
        throw new Error(`RoomGraph: duplicate connection ID ${connection.id}.`);
      }
      if (connection.fromRoomId === connection.toRoomId) {
        throw new Error(
          `RoomGraph: connection ${connection.id} cannot connect a room to itself.`,
        );
      }

      this.assertRoomExists(connection.fromRoomId);
      this.assertRoomExists(connection.toRoomId);
      this.validateConnection(connection);

      this.connectionsById.set(connection.id, connection);
      this.incidentByRoom.get(connection.fromRoomId)!.push(connection);
      this.incidentByRoom.get(connection.toRoomId)!.push(connection);

      this.neighborsByRoom
        .get(connection.fromRoomId)!
        .push(connection.toRoomId);
      this.neighborsByRoom
        .get(connection.toRoomId)!
        .push(connection.fromRoomId);
    }
  }

  private validateConnection(connection: RoomConnection): void {
    if (!Number.isInteger(connection.width) || connection.width < 1) {
      throw new Error(
        `RoomGraph: connection ${connection.id} has an invalid corridor width.`,
      );
    }

    if (
      !Array.isArray(connection.corridorPath) ||
      connection.corridorPath.length === 0
    ) {
      throw new Error(
        `RoomGraph: connection ${connection.id} has an empty corridorPath.`,
      );
    }

    for (let i = 0; i < connection.corridorPath.length; i++) {
      const point = connection.corridorPath[i];
      if (!Number.isInteger(point.x) || !Number.isInteger(point.y)) {
        throw new Error(
          `RoomGraph: connection ${connection.id} has a non-integer corridor path point.`,
        );
      }

      if (i > 0) {
        const previous = connection.corridorPath[i - 1];
        const manhattanDelta =
          Math.abs(point.x - previous.x) + Math.abs(point.y - previous.y);
        if (manhattanDelta !== 1) {
          throw new Error(
            `RoomGraph: connection ${connection.id} contains a non-cardinal or discontinuous ` +
              `corridorPath step at index ${i}.`,
          );
        }
      }
    }

    if (
      connection.doorways.length !== 2 ||
      connection.doorways[0].roomId !== connection.fromRoomId ||
      connection.doorways[1].roomId !== connection.toRoomId
    ) {
      throw new Error(
        `RoomGraph: connection ${connection.id} must contain two doorways matching its endpoints.`,
      );
    }
  }

  private sortIndexes(): void {
    for (const [roomId, neighbors] of this.neighborsByRoom) {
      this.neighborsByRoom.set(
        roomId,
        [...new Set(neighbors)].sort((a, b) => a - b),
      );
    }

    for (const connections of this.incidentByRoom.values()) {
      connections.sort((a, b) => a.id - b.id);
    }
  }

  private findLowestDistanceRoom(
    unvisited: ReadonlySet<number>,
    distances: ReadonlyMap<number, number>,
  ): number | undefined {
    let bestRoom: number | undefined;
    let bestDistance = Number.POSITIVE_INFINITY;

    for (const roomId of unvisited) {
      const distance = distances.get(roomId) ?? Number.POSITIVE_INFINITY;
      if (
        distance < bestDistance ||
        (distance === bestDistance &&
          bestRoom !== undefined &&
          roomId < bestRoom)
      ) {
        bestRoom = roomId;
        bestDistance = distance;
      }
    }

    return bestRoom;
  }

  private assertRoomExists(roomId: number): void {
    if (!this.roomsById.has(roomId)) {
      throw new Error(`RoomGraph: unknown room ID ${roomId}.`);
    }
  }
}

function otherEndpoint(connection: RoomConnection, roomId: number): number {
  if (connection.fromRoomId === roomId) return connection.toRoomId;
  if (connection.toRoomId === roomId) return connection.fromRoomId;
  throw new Error(
    `RoomGraph: room ${roomId} is not an endpoint of connection ${connection.id}.`,
  );
}

function getConnectionCost(connection: RoomConnection): number {
  // corridorPath is an anchor trace rather than a mathematical centerline.
  // Its number of points is a stable tile-length proxy for graph weighting.
  return Math.max(1, connection.corridorPath.length);
}

function reconstructRoomPath(
  previous: ReadonlyMap<number, number>,
  fromRoomId: number,
  toRoomId: number,
): number[] {
  const path = [toRoomId];
  let current = toRoomId;

  while (current !== fromRoomId) {
    const parent = previous.get(current);
    if (parent === undefined) {
      throw new Error("RoomGraph: failed to reconstruct a BFS path.");
    }
    current = parent;
    path.push(current);
  }

  path.reverse();
  return path;
}

function reconstructConnectionPath(
  previous: ReadonlyMap<number, PreviousStep>,
  fromRoomId: number,
  toRoomId: number,
): RoomConnection[] {
  const path: RoomConnection[] = [];
  let current = toRoomId;

  while (current !== fromRoomId) {
    const step = previous.get(current);
    if (!step) {
      throw new Error("RoomGraph: failed to reconstruct a connection path.");
    }
    path.push(step.connection);
    current = step.roomId;
  }

  path.reverse();
  return path;
}
