import { PRNG } from "../../PRNG.js";
import type { MapGenerationConfig } from "./config/MapGenerationConfig.js";
import type { TilePoint, TileRect } from "../MapGeometry.js";
import type { GeneratedRoom, RoomSpecialRole } from "./types/RoomTypes.js";
import type { RoomConnection } from "./types/ConnectionTypes.js";
import type {
  ClosetOrientation,
  GeneratedChalkChest,
  GeneratedCloset,
  GeneratedDoor,
  GeneratedGameplayObject,
  GameplayPlacementResult,
  GeneratedRitual,
  GeneratedSpawnArea,
} from "./types/GameplayTypes.js";
import { RoomGraph } from "./utils/RoomGraph.js";

interface RoomPlacementState {
  room: GeneratedRoom;
  footprint: Set<number>;
  reserved: Set<number>;
}

interface PlacementCandidate {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface ClosetPlacementCandidate extends PlacementCandidate {
  orientations: ClosetOrientation[];
}

const RITUAL_FOOTPRINT: Readonly<{ width: number; height: number }> = {
  width: 2,
  height: 2,
};

/**
 * Places gameplay entities using generated room metadata and the room graph.
 *
 * Responsibilities:
 * - Select exactly the configured number of eligible Ritual rooms.
 * - Assign player and monster spawn rooms and positions.
 * - Generate at most one two-tile doorway per RoomConnection, but only where
 *   the opening is flanked by solid wall tiles on both sides.
 * - Place one ritual altar in each Ritual room.
 * - Distribute chalk chests across regions around the Ritual rooms.
 * - Ensure every room is covered by a closet within coverageRadius graph hops.
 * - Place closets directly beside solid walls, facing SOUTH, WEST, or EAST.
 * - Scale additional closets according to playerCount.
 *
 * This class does not create Tiled Objects and does not mutate TiledMap.
 */
export class GameplayPlacementGenerator {
  private readonly width: number;
  private readonly height: number;

  constructor(
    private readonly config: MapGenerationConfig,
    private readonly rng: PRNG,
  ) {
    this.width = config.width;
    this.height = config.height;
    this.validateConfiguration();
  }

  /**
   * Creates all required gameplay placements for the supplied building.
   *
   * One door is attempted per connection. The corridor centerline is tried
   * first, followed by progressively nearer path positions. A door is only
   * accepted if it occupies exactly two corridor tiles and solid walls flank
   * the opening on both sides.
   */
  public generate(
    inputRooms: readonly GeneratedRoom[],
    connections: readonly RoomConnection[],
  ): GameplayPlacementResult {
    if (inputRooms.length === 0) {
      throw new Error(
        "GameplayPlacementGenerator: at least one room is required.",
      );
    }

    const rooms = inputRooms.map(cloneRoom);
    const graph = new RoomGraph(rooms, connections);

    if (!graph.isConnected()) {
      const components = graph.getConnectedComponents();
      throw new Error(
        "GameplayPlacementGenerator: gameplay placement requires a connected room graph. " +
          `Found ${components.length} components: ${components
            .map((component) => `[${component.join(", ")}]`)
            .join(" ")}.`,
      );
    }

    const roomStates = new Map<number, RoomPlacementState>();
    for (const room of rooms) {
      roomStates.set(room.id, {
        room,
        footprint: new Set(
          room.footprint.map((point) => this.cellKey(point.x, point.y)),
        ),
        reserved: new Set<number>(),
      });
    }

    // Match TilemapAssembler's collision model: room and corridor cells are
    // walkable; all other in-bounds cells are solid, with the map boundary
    // explicitly treated as solid by TilemapAssembler as well.
    const walkableCells = this.buildWalkableCells(rooms, connections);

    const objects: GeneratedGameplayObject[] = [];
    let nextObjectId = 1;

    // 1. Select rooms and assign their special gameplay roles.
    const ritualRooms = this.selectRitualRooms(rooms, graph);
    const ritualRoomIds = new Set(ritualRooms.map((room) => room.id));
    for (const room of ritualRooms) this.addRole(room, "RITUAL");

    const playerRoomCount = Math.ceil(
      this.config.playerCount / this.config.spawns.playerSpawnRoomCapacity,
    );
    const playerSpawnRooms = this.selectPlayerSpawnRooms(
      rooms,
      graph,
      ritualRoomIds,
      playerRoomCount,
      this.config.playerCount,
    );
    const playerSpawnRoomIds = new Set(playerSpawnRooms.map((room) => room.id));
    for (const room of playerSpawnRooms) this.addRole(room, "PLAYER_SPAWN");

    const monsterSpawnRooms = this.selectMonsterSpawnRooms(
      rooms,
      graph,
      new Set([...ritualRoomIds, ...playerSpawnRoomIds]),
    );
    for (const room of monsterSpawnRooms) this.addRole(room, "MONSTER_SPAWN");

    // 2. Create at most one properly flanked two-tile door per connection.
    if (this.config.interactables.doors) {
      for (const connection of [...connections].sort((a, b) => a.id - b.id)) {
        const placement = this.findConnectionDoorPlacement(
          connection,
          walkableCells,
        );
        if (!placement) continue;

        const door: GeneratedDoor = {
          id: nextObjectId++,
          kind: "Door",
          // Associate the door with the nearer endpoint room for legacy type compatibility.
          roomId:
            placement.pathIndex <= (connection.corridorPath.length - 1) / 2
              ? connection.fromRoomId
              : connection.toRoomId,
          connectionId: connection.id,
          position: { x: placement.footprint.x, y: placement.footprint.y },
          footprint: placement.footprint,
          orientation: placement.orientation,
          hinge: { x: placement.footprint.x, y: placement.footprint.y },
          initialState: this.config.interactables.doors.initialState,
        };
        objects.push(door);
      }
    }

    // 3. Place one 2x2 ritual altar in each selected Ritual room.
    for (let index = 0; index < ritualRooms.length; index++) {
      const room = ritualRooms[index];
      const placement = this.chooseRoomPlacement(
        roomStates.get(room.id)!,
        RITUAL_FOOTPRINT.width,
        RITUAL_FOOTPRINT.height,
        true,
        this.getRoomCenter(room),
      );

      if (!placement) {
        throw new Error(
          `GameplayPlacementGenerator: Ritual room ${room.id} (${room.templateId}) ` +
            "has no valid 2x2 interior footprint for its altar.",
        );
      }

      this.reservePlacement(roomStates.get(room.id)!, placement);
      const ritual: GeneratedRitual = {
        id: nextObjectId++,
        kind: "Ritual",
        roomId: room.id,
        ritualId: index + 1,
        position: { x: placement.x, y: placement.y },
        footprint: this.toRect(placement),
        chalkRequired: this.config.objectives.chalkPerRitual,
      };
      objects.push(ritual);
    }

    // 4. Place one SpawnArea point for each player and each monster spawn room.
    let playerSpawnIndex = 0;
    let remainingPlayers = this.config.playerCount;
    for (const room of playerSpawnRooms) {
      const occupants = Math.min(
        this.config.spawns.playerSpawnRoomCapacity,
        remainingPlayers,
      );
      const positions = this.chooseSeparatedRoomPoints(
        roomStates.get(room.id)!,
        occupants,
      );

      if (positions.length !== occupants) {
        throw new Error(
          `GameplayPlacementGenerator: player spawn room ${room.id} ` +
            `cannot fit ${occupants} distinct spawn positions.`,
        );
      }

      for (const position of positions) {
        const spawn: GeneratedSpawnArea = {
          id: nextObjectId++,
          kind: "SpawnArea",
          roomId: room.id,
          faction: "PLAYER",
          spawnIndex: playerSpawnIndex++,
          position,
          footprint: { x: position.x, y: position.y, width: 1, height: 1 },
        };
        objects.push(spawn);
      }

      remainingPlayers -= occupants;
    }

    let monsterSpawnIndex = 0;
    for (const room of monsterSpawnRooms) {
      const position = this.chooseRoomPlacement(
        roomStates.get(room.id)!,
        1,
        1,
        true,
      );
      if (!position) {
        throw new Error(
          `GameplayPlacementGenerator: monster spawn room ${room.id} has no valid interior spawn tile.`,
        );
      }

      const spawn: GeneratedSpawnArea = {
        id: nextObjectId++,
        kind: "SpawnArea",
        roomId: room.id,
        faction: "MONSTER",
        spawnIndex: monsterSpawnIndex++,
        position: { x: position.x, y: position.y },
        footprint: this.toRect(position),
      };
      objects.push(spawn);
      this.reservePlacement(roomStates.get(room.id)!, position);
    }

    // 5. Place closets before optional extra clutter so coverage remains a
    // hard constraint and cannot be displaced by chest placement.
    this.placeClosets(
      rooms,
      graph,
      roomStates,
      walkableCells,
      objects,
      () => nextObjectId++,
    );

    // 6. Place the required chalk chests, balanced between the three Ritual
    // regions. Rooms with CHEST_ELIGIBLE are preferred; Ritual rooms are not
    // used as chest locations.
    this.placeChalkChests(
      rooms,
      graph,
      ritualRooms,
      roomStates,
      objects,
      () => nextObjectId++,
    );

    return { rooms, objects };
  }

  private validateConfiguration(): void {
    const objectives = this.config.objectives;
    const spawns = this.config.spawns;
    const closets = this.config.interactables.closets;

    if (
      !Number.isInteger(objectives.ritualRoomCount) ||
      objectives.ritualRoomCount < 1
    ) {
      throw new Error(
        "GameplayPlacementGenerator: ritualRoomCount must be a positive integer.",
      );
    }
    if (
      !Number.isInteger(objectives.chalkPerRitual) ||
      objectives.chalkPerRitual < 1
    ) {
      throw new Error(
        "GameplayPlacementGenerator: chalkPerRitual must be a positive integer.",
      );
    }
    if (
      !Number.isInteger(objectives.extraChalkChests) ||
      objectives.extraChalkChests < 0
    ) {
      throw new Error(
        "GameplayPlacementGenerator: extraChalkChests must be a non-negative integer.",
      );
    }
    if (
      !Number.isInteger(spawns.playerSpawnRoomCapacity) ||
      spawns.playerSpawnRoomCapacity < 1
    ) {
      throw new Error(
        "GameplayPlacementGenerator: playerSpawnRoomCapacity must be a positive integer.",
      );
    }
    if (
      !Number.isInteger(spawns.monsterSpawnRoomCount) ||
      spawns.monsterSpawnRoomCount < 1
    ) {
      throw new Error(
        "GameplayPlacementGenerator: monsterSpawnRoomCount must be a positive integer.",
      );
    }
    if (
      !Number.isInteger(spawns.minMonsterPlayerSpawnDistance) ||
      spawns.minMonsterPlayerSpawnDistance < 0
    ) {
      throw new Error(
        "GameplayPlacementGenerator: minMonsterPlayerSpawnDistance must be a non-negative integer.",
      );
    }
    if (
      !Number.isInteger(closets.coverageRadius) ||
      closets.coverageRadius < 0
    ) {
      throw new Error(
        "GameplayPlacementGenerator: coverageRadius must be a non-negative integer.",
      );
    }
    if (
      !Number.isFinite(closets.additionalPerPlayer) ||
      closets.additionalPerPlayer < 0
    ) {
      throw new Error(
        "GameplayPlacementGenerator: additionalPerPlayer must be non-negative.",
      );
    }
    if (
      !Number.isInteger(this.width) ||
      this.width < 1 ||
      !Number.isInteger(this.height) ||
      this.height < 1
    ) {
      throw new Error(
        "GameplayPlacementGenerator: map dimensions must be positive integers.",
      );
    }
    if (
      !Number.isInteger(this.config.playerCount) ||
      this.config.playerCount < 1 ||
      this.config.playerCount > 4
    ) {
      throw new Error(
        "GameplayPlacementGenerator: playerCount must be an integer from 1 to 4.",
      );
    }
  }

  private selectRitualRooms(
    rooms: readonly GeneratedRoom[],
    graph: RoomGraph,
  ): GeneratedRoom[] {
    const candidates = rooms.filter((room) =>
      room.capabilities.includes("RITUAL_ELIGIBLE"),
    );
    const count = this.config.objectives.ritualRoomCount;

    if (candidates.length < count) {
      throw new Error(
        `GameplayPlacementGenerator: ${count} Ritual rooms are required, but only ` +
          `${candidates.length} rooms have RITUAL_ELIGIBLE.`,
      );
    }

    return this.selectMaximallySpacedRooms(candidates, count, graph);
  }

  /**
   * Selects a set by farthest-point sampling using weighted corridor distance.
   * This spreads special rooms across the building without requiring all
   * possible combinations to be evaluated.
   */
  private selectMaximallySpacedRooms(
    candidates: readonly GeneratedRoom[],
    count: number,
    graph: RoomGraph,
  ): GeneratedRoom[] {
    const pool = this.shuffle([...candidates].sort((a, b) => a.id - b.id));
    const selected: GeneratedRoom[] = [pool.shift()!];

    while (selected.length < count) {
      let bestScore = Number.NEGATIVE_INFINITY;
      let bestCandidates: GeneratedRoom[] = [];

      for (const candidate of pool) {
        const minimumDistance = Math.min(
          ...selected.map((room) =>
            graph.getShortestPathLength(candidate.id, room.id),
          ),
        );

        if (minimumDistance > bestScore) {
          bestScore = minimumDistance;
          bestCandidates = [candidate];
        } else if (minimumDistance === bestScore) {
          bestCandidates.push(candidate);
        }
      }

      if (bestCandidates.length === 0 || !Number.isFinite(bestScore)) {
        throw new Error(
          "GameplayPlacementGenerator: Ritual rooms cannot be distributed over the connected room graph.",
        );
      }

      const selectedRoom =
        bestCandidates[this.rng.nextInt(0, bestCandidates.length)];
      selected.push(selectedRoom);
      pool.splice(
        pool.findIndex((room) => room.id === selectedRoom.id),
        1,
      );
    }

    return selected;
  }

  private selectPlayerSpawnRooms(
    rooms: readonly GeneratedRoom[],
    graph: RoomGraph,
    excludedRoomIds: ReadonlySet<number>,
    count: number,
    playerCount: number,
  ): GeneratedRoom[] {
    const candidates = rooms.filter(
      (room) =>
        !excludedRoomIds.has(room.id) &&
        room.capabilities.includes("PLAYER_SPAWN_ELIGIBLE") &&
        this.getAvailablePlacements(this.createRoomState(room), 1, 1, true)
          .length >=
          Math.min(this.config.spawns.playerSpawnRoomCapacity, playerCount),
    );

    if (candidates.length < count) {
      throw new Error(
        `GameplayPlacementGenerator: ${count} player spawn rooms are required, ` +
          `but only ${candidates.length} eligible rooms have sufficient interior space.`,
      );
    }

    if (count === 1) {
      const shuffled = this.shuffle([...candidates]);
      return [shuffled[0]];
    }

    // Player spawn rooms are kept close together so a party split across two
    // rooms can regroup quickly. Additional rooms are greedily attached to
    // the already selected group.
    const shuffled = this.shuffle([...candidates]);
    const selected: GeneratedRoom[] = [shuffled.shift()!];

    while (selected.length < count) {
      let bestScore = Number.POSITIVE_INFINITY;
      let bestCandidates: GeneratedRoom[] = [];

      for (const candidate of shuffled) {
        const nearestDistance = Math.min(
          ...selected.map((room) =>
            graph.getShortestPathLength(candidate.id, room.id),
          ),
        );
        if (nearestDistance < bestScore) {
          bestScore = nearestDistance;
          bestCandidates = [candidate];
        } else if (nearestDistance === bestScore) {
          bestCandidates.push(candidate);
        }
      }

      if (bestCandidates.length === 0 || !Number.isFinite(bestScore)) break;
      const chosen = bestCandidates[this.rng.nextInt(0, bestCandidates.length)];
      selected.push(chosen);
      shuffled.splice(
        shuffled.findIndex((room) => room.id === chosen.id),
        1,
      );
    }

    if (selected.length !== count) {
      throw new Error(
        "GameplayPlacementGenerator: unable to select distinct player spawn rooms.",
      );
    }

    return selected;
  }

  private selectMonsterSpawnRooms(
    rooms: readonly GeneratedRoom[],
    graph: RoomGraph,
    excludedRoomIds: ReadonlySet<number>,
  ): GeneratedRoom[] {
    const candidates = rooms.filter(
      (room) =>
        !excludedRoomIds.has(room.id) &&
        room.capabilities.includes("MONSTER_SPAWN_ELIGIBLE") &&
        this.getAvailablePlacements(this.createRoomState(room), 1, 1, true)
          .length > 0,
    );
    const required = this.config.spawns.monsterSpawnRoomCount;

    if (candidates.length < required) {
      throw new Error(
        `GameplayPlacementGenerator: ${required} monster spawn rooms are required, ` +
          `but only ${candidates.length} eligible rooms are available after excluding Ritual and player spawn rooms.`,
      );
    }

    const minDistance = this.config.spawns.minMonsterPlayerSpawnDistance;
    const playerRooms = rooms.filter((room) =>
      room.specialRoles.includes("PLAYER_SPAWN"),
    );
    const feasible = candidates.filter((candidate) =>
      playerRooms.every(
        (playerRoom) =>
          graph.getDistance(candidate.id, playerRoom.id) >= minDistance,
      ),
    );

    if (feasible.length < required) {
      const bestAvailableDistance = candidates.reduce(
        (best, candidate) =>
          Math.max(
            best,
            Math.min(
              ...playerRooms.map((playerRoom) =>
                graph.getDistance(candidate.id, playerRoom.id),
              ),
            ),
          ),
        Number.NEGATIVE_INFINITY,
      );

      throw new Error(
        `GameplayPlacementGenerator: cannot place ${required} monster spawn room(s) at least ` +
          `${minDistance} graph edge(s) from every player spawn room. ` +
          `Best available minimum distance is ${bestAvailableDistance}. ` +
          "Reduce minMonsterPlayerSpawnDistance, change spawn-eligible templates, or regenerate the building.",
      );
    }

    const selected: GeneratedRoom[] = [];
    const pool = this.shuffle([...feasible]);

    while (selected.length < required) {
      let bestScore = Number.NEGATIVE_INFINITY;
      let bestCandidates: GeneratedRoom[] = [];

      for (const candidate of pool) {
        const playerDistance = Math.min(
          ...playerRooms.map((room) =>
            graph.getDistance(candidate.id, room.id),
          ),
        );
        const selectedMonsterDistance =
          selected.length === 0
            ? Number.POSITIVE_INFINITY
            : Math.min(
                ...selected.map((room) =>
                  graph.getDistance(candidate.id, room.id),
                ),
              );
        const score = Math.min(playerDistance, selectedMonsterDistance);

        if (score > bestScore) {
          bestScore = score;
          bestCandidates = [candidate];
        } else if (score === bestScore) {
          bestCandidates.push(candidate);
        }
      }

      if (bestCandidates.length === 0) {
        throw new Error(
          "GameplayPlacementGenerator: unable to select monster spawn rooms.",
        );
      }

      const chosen = bestCandidates[this.rng.nextInt(0, bestCandidates.length)];
      selected.push(chosen);
      pool.splice(
        pool.findIndex((room) => room.id === chosen.id),
        1,
      );
    }

    return selected;
  }

  private placeClosets(
    rooms: readonly GeneratedRoom[],
    graph: RoomGraph,
    roomStates: ReadonlyMap<number, RoomPlacementState>,
    walkableCells: ReadonlySet<number>,
    objects: GeneratedGameplayObject[],
    nextId: () => number,
  ): void {
    const eligible = rooms.filter(
      (room) =>
        room.capabilities.includes("CLOSET_ELIGIBLE") &&
        this.getAvailableClosetPlacements(
          roomStates.get(room.id)!,
          walkableCells,
        ).length > 0,
    );
    const radius = this.config.interactables.closets.coverageRadius;
    const uncovered = new Set(rooms.map((room) => room.id));
    const selectedRooms: GeneratedRoom[] = [];
    const closetCounts = new Map<number, number>();

    // Greedy set cover: each selected closet room covers itself and all rooms
    // at graph distance <= coverageRadius.
    while (uncovered.size > 0) {
      let bestCandidates: Array<{ room: GeneratedRoom; covered: number[] }> =
        [];
      let bestScore = 0;

      for (const candidate of eligible) {
        if ((closetCounts.get(candidate.id) ?? 0) > 0) continue;
        const covered = [...uncovered].filter(
          (roomId) => graph.getDistance(roomId, candidate.id) <= radius,
        );
        if (covered.length > bestScore) {
          bestScore = covered.length;
          bestCandidates = [{ room: candidate, covered }];
        } else if (covered.length === bestScore && covered.length > 0) {
          bestCandidates.push({ room: candidate, covered });
        }
      }

      if (bestCandidates.length === 0) {
        throw new Error(
          "GameplayPlacementGenerator: closet coverage cannot be satisfied. " +
            `Uncovered room IDs: ${[...uncovered].sort((a, b) => a - b).join(", ")}. ` +
            `No CLOSET_ELIGIBLE room with an available wall-adjacent tile covers them within ${radius} graph edge(s).`,
        );
      }

      const selectedCandidate =
        bestCandidates[this.rng.nextInt(0, bestCandidates.length)].room;
      const placement = this.chooseClosetPlacement(
        roomStates.get(selectedCandidate.id)!,
        walkableCells,
      );

      if (!placement) {
        // The room was eligible during scoring but a previous placement may
        // have consumed its last wall-adjacent slot. Make it unavailable and retry.
        const index = eligible.findIndex(
          (room) => room.id === selectedCandidate.id,
        );
        if (index >= 0) eligible.splice(index, 1);
        continue;
      }

      this.reservePlacement(roomStates.get(selectedCandidate.id)!, placement);
      objects.push(
        this.createCloset(nextId(), selectedCandidate.id, placement),
      );
      closetCounts.set(selectedCandidate.id, 1);
      selectedRooms.push(selectedCandidate);

      for (const roomId of [...uncovered]) {
        if (graph.getDistance(roomId, selectedCandidate.id) <= radius) {
          uncovered.delete(roomId);
        }
      }
    }

    const baseCount = selectedRooms.length;
    const targetCount = Math.ceil(
      baseCount *
        (1 +
          this.config.interactables.closets.additionalPerPlayer *
            (this.config.playerCount - 1)),
    );

    // Extra closets are spread toward rooms farther from existing closets.
    while (
      [...closetCounts.values()].reduce((sum, count) => sum + count, 0) <
      targetCount
    ) {
      const candidates = eligible.filter(
        (room) =>
          this.getAvailableClosetPlacements(
            roomStates.get(room.id)!,
            walkableCells,
          ).length > 0,
      );

      if (candidates.length === 0) {
        throw new Error(
          `GameplayPlacementGenerator: closet target ${targetCount} cannot be reached; ` +
            "eligible rooms have no remaining wall-adjacent placement cells.",
        );
      }

      let bestScore = Number.NEGATIVE_INFINITY;
      let bestCandidates: GeneratedRoom[] = [];
      for (const candidate of candidates) {
        const nearestClosetRoomDistance = Math.min(
          ...selectedRooms.map((room) =>
            graph.getDistance(candidate.id, room.id),
          ),
        );
        const score =
          nearestClosetRoomDistance -
          (closetCounts.get(candidate.id) ?? 0) * 0.01;
        if (score > bestScore) {
          bestScore = score;
          bestCandidates = [candidate];
        } else if (score === bestScore) {
          bestCandidates.push(candidate);
        }
      }

      const chosen = bestCandidates[this.rng.nextInt(0, bestCandidates.length)];
      const placement = this.chooseClosetPlacement(
        roomStates.get(chosen.id)!,
        walkableCells,
      );
      if (!placement) {
        throw new Error(
          `GameplayPlacementGenerator: selected closet room ${chosen.id} has no remaining wall-adjacent placement cell.`,
        );
      }

      this.reservePlacement(roomStates.get(chosen.id)!, placement);
      objects.push(this.createCloset(nextId(), chosen.id, placement));
      closetCounts.set(chosen.id, (closetCounts.get(chosen.id) ?? 0) + 1);
      if (!selectedRooms.some((room) => room.id === chosen.id)) {
        selectedRooms.push(chosen);
      }
    }
  }

  private placeChalkChests(
    rooms: readonly GeneratedRoom[],
    graph: RoomGraph,
    ritualRooms: readonly GeneratedRoom[],
    roomStates: ReadonlyMap<number, RoomPlacementState>,
    objects: GeneratedGameplayObject[],
    nextId: () => number,
  ): void {
    const chestCount =
      ritualRooms.length * this.config.objectives.chalkPerRitual +
      this.config.objectives.extraChalkChests;

    if (chestCount === 0) return;

    const ritualRoomIds = new Set(ritualRooms.map((room) => room.id));
    const allEligibleRooms = rooms.filter(
      (room) =>
        !ritualRoomIds.has(room.id) &&
        room.capabilities.includes("CHEST_ELIGIBLE") &&
        this.getAvailablePlacements(roomStates.get(room.id)!, 1, 1, true)
          .length > 0,
    );
    const nonSpawnEligibleRooms = allEligibleRooms.filter(
      (room) =>
        !room.specialRoles.includes("PLAYER_SPAWN") &&
        !room.specialRoles.includes("MONSTER_SPAWN"),
    );
    // Prefer not to place objective resources directly in spawn rooms. Spawn
    // rooms remain a fallback if the rest of the map has insufficient capacity.
    const eligibleRooms =
      nonSpawnEligibleRooms.length > 0
        ? nonSpawnEligibleRooms
        : allEligibleRooms;

    if (eligibleRooms.length === 0) {
      throw new Error(
        `GameplayPlacementGenerator: ${chestCount} chalk chests are required, ` +
          "but no non-Ritual room has CHEST_ELIGIBLE and an available interior tile.",
      );
    }

    // Assign every chest-eligible room to its nearest Ritual region using
    // weighted corridor distance. Equal-distance ties are resolved by the seed.
    const roomRegion = new Map<number, number>();
    for (const room of eligibleRooms) {
      let minimumDistance = Number.POSITIVE_INFINITY;
      let nearestRituals: GeneratedRoom[] = [];

      for (const ritual of ritualRooms) {
        const distance = graph.getShortestPathLength(room.id, ritual.id);
        if (distance < minimumDistance) {
          minimumDistance = distance;
          nearestRituals = [ritual];
        } else if (distance === minimumDistance) {
          nearestRituals.push(ritual);
        }
      }

      if (nearestRituals.length === 0 || !Number.isFinite(minimumDistance)) {
        throw new Error(
          `GameplayPlacementGenerator: chest-eligible room ${room.id} cannot be assigned to a Ritual region.`,
        );
      }

      const nearestRitual =
        nearestRituals[this.rng.nextInt(0, nearestRituals.length)];
      roomRegion.set(room.id, nearestRitual.id);
    }

    const regions = ritualRooms.map((room) => room.id);
    const chestQuota = new Map<number, number>();
    const baseQuota = Math.floor(chestCount / regions.length);
    let remainder = chestCount % regions.length;
    const remainderOrder = this.shuffle([...regions]);

    for (const regionId of regions) chestQuota.set(regionId, baseQuota);
    for (const regionId of remainderOrder) {
      if (remainder <= 0) break;
      chestQuota.set(regionId, (chestQuota.get(regionId) ?? 0) + 1);
      remainder--;
    }

    const roomChestCounts = new Map<number, number>();
    for (const room of eligibleRooms) roomChestCounts.set(room.id, 0);

    // Fill each Ritual region to its balanced quota. Within a region, rooms
    // with fewer existing chests are preferred, so distinct rooms are used
    // before multiple chests are placed in the same room.
    for (const regionId of regions) {
      const quota = chestQuota.get(regionId) ?? 0;
      for (let placed = 0; placed < quota; placed++) {
        const availableRooms = eligibleRooms.filter(
          (room) =>
            this.getAvailablePlacements(roomStates.get(room.id)!, 1, 1, true)
              .length > 0,
        );

        if (availableRooms.length === 0) {
          throw new Error(
            `GameplayPlacementGenerator: could fit only ${placed} of ${quota} chalk chests ` +
              `for Ritual region ${regionId}; no CHEST_ELIGIBLE interior cells remain.`,
          );
        }

        // Prefer distributing chests across distinct rooms before placing a
        // second chest in any room. Among equally used rooms, prefer this
        // Ritual's nearest-region partition; if that partition is exhausted,
        // use the nearest remaining eligible rooms anywhere in the building.
        const leastUsedCount = Math.min(
          ...availableRooms.map((room) => roomChestCounts.get(room.id) ?? 0),
        );
        const leastUsedRooms = availableRooms.filter(
          (room) => (roomChestCounts.get(room.id) ?? 0) === leastUsedCount,
        );
        const localLeastUsedRooms = leastUsedRooms.filter(
          (room) => roomRegion.get(room.id) === regionId,
        );
        const candidates =
          localLeastUsedRooms.length > 0 ? localLeastUsedRooms : leastUsedRooms;
        let nearestDistance = Number.POSITIVE_INFINITY;
        let nearestRooms: GeneratedRoom[] = [];
        for (const room of candidates) {
          const distance = graph.getShortestPathLength(room.id, regionId);
          if (distance < nearestDistance) {
            nearestDistance = distance;
            nearestRooms = [room];
          } else if (distance === nearestDistance) {
            nearestRooms.push(room);
          }
        }
        const selectedRoom = this.shuffle(nearestRooms)[0];
        const roomState = roomStates.get(selectedRoom.id)!;
        const placement = this.chooseRoomPlacement(roomState, 1, 1, true);

        if (!placement) {
          throw new Error(
            `GameplayPlacementGenerator: room ${selectedRoom.id} unexpectedly lost its chest placement cell.`,
          );
        }

        this.reservePlacement(roomState, placement);
        const chest: GeneratedChalkChest = {
          id: nextId(),
          kind: "Chest",
          roomId: selectedRoom.id,
          position: { x: placement.x, y: placement.y },
          footprint: this.toRect(placement),
          item: "CHALK",
          amount: 1,
          regionRitualId: regionId,
        };
        objects.push(chest);
        roomChestCounts.set(
          selectedRoom.id,
          (roomChestCounts.get(selectedRoom.id) ?? 0) + 1,
        );
      }
    }
  }

  private chooseRoomPlacement(
    state: RoomPlacementState,
    width: number,
    height: number,
    requireOneTileInteriorMargin: boolean,
    preferredPoint?: TilePoint,
  ): PlacementCandidate | undefined {
    const candidates = this.getAvailablePlacements(
      state,
      width,
      height,
      requireOneTileInteriorMargin,
    );
    if (candidates.length === 0) return undefined;

    if (!preferredPoint) {
      return candidates[this.rng.nextInt(0, candidates.length)];
    }

    // Prefer positions close to the room center for altars. Random tie-breaking
    // preserves deterministic variation between seeds.
    let bestDistance = Number.POSITIVE_INFINITY;
    let bestCandidates: PlacementCandidate[] = [];
    for (const candidate of candidates) {
      const centerX = candidate.x + (candidate.width - 1) / 2;
      const centerY = candidate.y + (candidate.height - 1) / 2;
      const distance =
        Math.abs(centerX - preferredPoint.x) +
        Math.abs(centerY - preferredPoint.y);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestCandidates = [candidate];
      } else if (distance === bestDistance) {
        bestCandidates.push(candidate);
      }
    }
    return bestCandidates[this.rng.nextInt(0, bestCandidates.length)];
  }

  private chooseSeparatedRoomPoints(
    state: RoomPlacementState,
    count: number,
  ): TilePoint[] {
    const selected: TilePoint[] = [];

    while (selected.length < count) {
      const candidates = this.getAvailablePlacements(state, 1, 1, true);
      if (candidates.length === 0) break;

      let chosen: PlacementCandidate;
      if (selected.length === 0) {
        chosen = candidates[this.rng.nextInt(0, candidates.length)];
      } else {
        let bestDistance = Number.NEGATIVE_INFINITY;
        let bestCandidates: PlacementCandidate[] = [];
        for (const candidate of candidates) {
          const minimumDistance = Math.min(
            ...selected.map(
              (point) =>
                Math.abs(candidate.x - point.x) +
                Math.abs(candidate.y - point.y),
            ),
          );
          if (minimumDistance > bestDistance) {
            bestDistance = minimumDistance;
            bestCandidates = [candidate];
          } else if (minimumDistance === bestDistance) {
            bestCandidates.push(candidate);
          }
        }
        chosen = bestCandidates[this.rng.nextInt(0, bestCandidates.length)];
      }

      this.reservePlacement(state, chosen);
      selected.push({ x: chosen.x, y: chosen.y });
    }

    return selected;
  }

  private getAvailablePlacements(
    state: RoomPlacementState,
    width: number,
    height: number,
    requireOneTileInteriorMargin: boolean,
  ): PlacementCandidate[] {
    const candidates: PlacementCandidate[] = [];
    const bounds = state.room.bounds;

    for (let y = bounds.y; y <= bounds.y + bounds.height - height; y++) {
      for (let x = bounds.x; x <= bounds.x + bounds.width - width; x++) {
        let valid = true;

        const margin = requireOneTileInteriorMargin ? 1 : 0;
        for (
          let checkY = y - margin;
          checkY < y + height + margin && valid;
          checkY++
        ) {
          for (let checkX = x - margin; checkX < x + width + margin; checkX++) {
            if (!state.footprint.has(this.cellKey(checkX, checkY))) {
              valid = false;
              break;
            }
          }
        }
        if (!valid) continue;

        for (let py = y; py < y + height && valid; py++) {
          for (let px = x; px < x + width; px++) {
            if (state.reserved.has(this.cellKey(px, py))) {
              valid = false;
              break;
            }
          }
        }
        if (valid) candidates.push({ x, y, width, height });
      }
    }

    return candidates;
  }

  /**
   * Returns every available one-tile room position that touches a solid wall.
   * Only SOUTH, WEST and EAST orientations are considered. The corresponding
   * wall is behind the closet, so the closet faces away from that wall.
   */
  private getAvailableClosetPlacements(
    state: RoomPlacementState,
    walkableCells: ReadonlySet<number>,
  ): ClosetPlacementCandidate[] {
    const candidates: ClosetPlacementCandidate[] = [];
    const visited = new Set<number>();

    for (const point of state.room.footprint) {
      const { x, y } = point;
      const key = this.cellKey(x, y);

      if (visited.has(key)) continue;
      visited.add(key);

      if (
        !state.footprint.has(key) ||
        state.reserved.has(key) ||
        !this.isWalkableTile(x, y, walkableCells)
      ) {
        continue;
      }

      const orientations: ClosetOrientation[] = [];

      // Wall to the north -> closet faces south.
      if (this.isSolidTile(x, y - 1, walkableCells)) {
        orientations.push("SOUTH");
      }

      // Wall to the east -> closet faces west.
      if (this.isSolidTile(x + 1, y, walkableCells)) {
        orientations.push("WEST");
      }

      // Wall to the west -> closet faces east.
      if (this.isSolidTile(x - 1, y, walkableCells)) {
        orientations.push("EAST");
      }

      if (orientations.length === 0) continue;

      candidates.push({
        x,
        y,
        width: 1,
        height: 1,
        orientations,
      });
    }

    return candidates;
  }

  private chooseClosetPlacement(
    state: RoomPlacementState,
    walkableCells: ReadonlySet<number>,
  ): ClosetPlacementCandidate | undefined {
    const candidates = this.getAvailableClosetPlacements(state, walkableCells);

    if (candidates.length === 0) return undefined;
    return candidates[this.rng.nextInt(0, candidates.length)];
  }

  private createCloset(
    id: number,
    roomId: number,
    placement: ClosetPlacementCandidate,
  ): GeneratedCloset {
    const orientation =
      placement.orientations[
        this.rng.nextInt(0, placement.orientations.length)
      ];

    return {
      id,
      kind: "Closet",
      roomId,
      position: { x: placement.x, y: placement.y },
      footprint: this.toRect(placement),
      orientation,
    };
  }

  /**
   * Finds one corridor-sized door footprint for a connection. The midpoint is
   * attempted first; remaining anchors are tested by increasing path distance.
   * A door opening is always exactly two tiles wide.
   */
  private findConnectionDoorPlacement(
    connection: RoomConnection,
    walkableCells: ReadonlySet<number>,
  ): {
    footprint: TileRect;
    orientation: "NORTH" | "EAST" | "SOUTH" | "WEST";
    pathIndex: number;
  } | null {
    const path = connection.corridorPath;
    if (path.length === 0 || connection.width !== 2) return null;

    const corridorCells = this.getConnectionCorridorCells(connection);
    const midpoint = (path.length - 1) / 2;
    const candidateIndexes = path
      .map((_, index) => index)
      .sort((a, b) => Math.abs(a - midpoint) - Math.abs(b - midpoint) || a - b);

    for (const pathIndex of candidateIndexes) {
      // FIX 1: REJECT CORNERS.
      // A door cannot be placed at a turn. It must be on a straight path.
      if (pathIndex > 0 && pathIndex < path.length - 1) {
        const prev = path[pathIndex - 1];
        const curr = path[pathIndex];
        const next = path[pathIndex + 1];

        const incomingDx = curr.x - prev.x;
        const incomingDy = curr.y - prev.y;
        const outgoingDx = next.x - curr.x;
        const outgoingDy = next.y - curr.y;

        // If the path changes direction, this is a corner. Skip it.
        if (
          (incomingDx !== 0 && outgoingDy !== 0) ||
          (incomingDy !== 0 && outgoingDx !== 0)
        ) {
          continue;
        }
      }

      // FIX 2: Use the incoming direction to determine orientation
      const orientation = this.getDoorOrientationAtPathIndex(path, pathIndex);
      const footprint = this.getDoorFootprint(path[pathIndex], orientation, 2);

      let valid = true;
      for (
        let y = footprint.y;
        y < footprint.y + footprint.height && valid;
        y++
      ) {
        for (let x = footprint.x; x < footprint.x + footprint.width; x++) {
          if (
            x < 0 ||
            y < 0 ||
            x >= this.width ||
            y >= this.height ||
            !corridorCells.has(this.cellKey(x, y)) ||
            !this.isWalkableTile(x, y, walkableCells)
          ) {
            valid = false;
            break;
          }
        }
      }

      if (!valid) continue;
      if (!this.hasValidDoorwayWalls(footprint, orientation, walkableCells)) {
        continue;
      }

      return { footprint, orientation, pathIndex };
    }

    return null;
  }

  private getDoorOrientationAtPathIndex(
    path: readonly TilePoint[],
    index: number,
  ): "NORTH" | "EAST" | "SOUTH" | "WEST" {
    // If it's the very first point, we look forward.
    if (index === 0) {
      const neighbor = path[1];
      if (neighbor.x !== path[0].x) return "EAST";
      return "SOUTH";
    }

    // Otherwise, we look BACKWARDS to see where we came from.
    // This ensures the door is perpendicular to the corridor we are traveling on.
    const previous = path[index - 1];
    const current = path[index];

    if (current.x !== previous.x) return "EAST"; // Moved horizontally, so door is vertical (EAST plane)
    return "SOUTH"; // Moved vertically, so door is horizontal (SOUTH plane)
  }

  /**
   * Checks the two solid wall cells flanking the doorway and confirms that
   * the passage continues through the opening on both sides.
   *
   * EAST/WEST orientations use a vertical two-tile footprint. Its flanking
   * walls are immediately north and south of that footprint.
   * NORTH/SOUTH orientations use a horizontal two-tile footprint. Its
   * flanking walls are immediately west and east of that footprint.
   */
  private hasValidDoorwayWalls(
    footprint: TileRect,
    orientation: "NORTH" | "EAST" | "SOUTH" | "WEST",
    walkableCells: ReadonlySet<number>,
  ): boolean {
    if (footprint.width * footprint.height !== 2) return false;

    if (orientation === "EAST" || orientation === "WEST") {
      if (footprint.width !== 1 || footprint.height !== 2) return false;

      const x = footprint.x;
      const top = footprint.y;
      const bottom = footprint.y + 1;

      if (
        !this.isSolidTile(x, top - 1, walkableCells) ||
        !this.isSolidTile(x, bottom + 1, walkableCells)
      ) {
        return false;
      }

      for (let y = top; y <= bottom; y++) {
        if (
          !this.isWalkableTile(x - 1, y, walkableCells) ||
          !this.isWalkableTile(x + 1, y, walkableCells)
        ) {
          return false;
        }
      }

      return true;
    }

    if (footprint.width !== 2 || footprint.height !== 1) return false;

    const left = footprint.x;
    const right = footprint.x + 1;
    const y = footprint.y;

    if (
      !this.isSolidTile(left - 1, y, walkableCells) ||
      !this.isSolidTile(right + 1, y, walkableCells)
    ) {
      return false;
    }

    for (let x = left; x <= right; x++) {
      if (
        !this.isWalkableTile(x, y - 1, walkableCells) ||
        !this.isWalkableTile(x, y + 1, walkableCells)
      ) {
        return false;
      }
    }

    return true;
  }

  /** Reconstructs the corridor footprint with ConnectivityGenerator's width-band convention. */
  private getConnectionCorridorCells(connection: RoomConnection): Set<number> {
    const path = connection.corridorPath;
    const width = connection.width;
    const cells = new Set<number>();
    const add = (x: number, y: number): void => {
      if (x >= 0 && y >= 0 && x < this.width && y < this.height) {
        cells.add(this.cellKey(x, y));
      }
    };

    if (path.length === 1) {
      const orientation = connection.doorways[0]?.orientation ?? "NORTH";
      const horizontalSpan = orientation === "NORTH" || orientation === "SOUTH";
      for (let offset = 0; offset < width; offset++) {
        add(
          path[0].x + (horizontalSpan ? 0 : offset),
          path[0].y + (horizontalSpan ? offset : 0),
        );
      }
      return cells;
    }

    for (let i = 0; i < path.length - 1; i++) {
      const a = path[i];
      const b = path[i + 1];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      if (Math.abs(dx) + Math.abs(dy) !== 1) continue;

      if (dx !== 0) {
        for (let offset = 0; offset < width; offset++) {
          add(a.x, a.y + offset);
          add(b.x, b.y + offset);
        }
      } else {
        for (let offset = 0; offset < width; offset++) {
          add(a.x + offset, a.y);
          add(b.x + offset, b.y);
        }
      }

      if (i > 0) {
        const previous = path[i - 1];
        const previousDx = a.x - previous.x;
        // const previousDy = a.y - previous.y;
        if ((previousDx === 0) !== (dx === 0)) {
          for (let y = 0; y < width; y++) {
            for (let x = 0; x < width; x++) add(a.x + x, a.y + y);
          }
        }
      }
    }
    return cells;
  }

  private getDoorFootprint(
    position: TilePoint,
    orientation: "NORTH" | "EAST" | "SOUTH" | "WEST",
    width: number,
  ): TileRect {
    if (orientation === "NORTH" || orientation === "SOUTH") {
      return { x: position.x, y: position.y, width, height: 1 };
    }
    return { x: position.x, y: position.y, width: 1, height: width };
  }

  /**
   * Builds the map's walkable cell set from room and corridor footprints.
   * This mirrors TilemapAssembler's geometry rules without depending on the
   * assembled Tiled layers.
   */
  private buildWalkableCells(
    rooms: readonly GeneratedRoom[],
    connections: readonly RoomConnection[],
  ): Set<number> {
    const cells = new Set<number>();

    for (const room of rooms) {
      for (const point of room.footprint) {
        cells.add(this.cellKey(point.x, point.y));
      }
    }

    for (const connection of connections) {
      for (const key of this.getConnectionCorridorCells(connection)) {
        cells.add(key);
      }
    }

    return cells;
  }

  private isMapBoundary(x: number, y: number): boolean {
    return x === 0 || y === 0 || x === this.width - 1 || y === this.height - 1;
  }

  private isWalkableTile(
    x: number,
    y: number,
    walkableCells: ReadonlySet<number>,
  ): boolean {
    if (
      x < 0 ||
      y < 0 ||
      x >= this.width ||
      y >= this.height ||
      this.isMapBoundary(x, y)
    ) {
      return false;
    }

    return walkableCells.has(this.cellKey(x, y));
  }

  private isSolidTile(
    x: number,
    y: number,
    walkableCells: ReadonlySet<number>,
  ): boolean {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) {
      return false;
    }

    // TilemapAssembler marks every outer boundary cell as wall.
    if (this.isMapBoundary(x, y)) return true;
    return !walkableCells.has(this.cellKey(x, y));
  }

  private reservePlacement(
    state: RoomPlacementState,
    placement: PlacementCandidate | TileRect,
  ): void {
    const x = placement.x;
    const y = placement.y;
    const width = placement.width;
    const height = placement.height;
    for (let py = y; py < y + height; py++) {
      for (let px = x; px < x + width; px++) {
        const key = this.cellKey(px, py);
        if (!state.footprint.has(key)) {
          throw new Error(
            `GameplayPlacementGenerator: attempted to reserve a tile outside room ${state.room.id} at (${px}, ${py}).`,
          );
        }
        if (state.reserved.has(key)) {
          throw new Error(
            `GameplayPlacementGenerator: attempted overlapping placement in room ${state.room.id} at (${px}, ${py}).`,
          );
        }
        state.reserved.add(key);
      }
    }
  }

  private getRoomCenter(room: GeneratedRoom): TilePoint {
    return {
      x: room.bounds.x + (room.bounds.width - 1) / 2,
      y: room.bounds.y + (room.bounds.height - 1) / 2,
    };
  }

  private toRect(placement: PlacementCandidate): TileRect {
    return {
      x: placement.x,
      y: placement.y,
      width: placement.width,
      height: placement.height,
    };
  }

  private addRole(room: GeneratedRoom, role: RoomSpecialRole): void {
    if (!room.specialRoles.includes(role)) room.specialRoles.push(role);
  }

  private createRoomState(room: GeneratedRoom): RoomPlacementState {
    return {
      room,
      footprint: new Set(
        room.footprint.map((point) => this.cellKey(point.x, point.y)),
      ),
      reserved: new Set<number>(),
    };
  }

  private cellKey(x: number, y: number): number {
    return y * this.width + x;
  }

  private shuffle<T>(values: T[]): T[] {
    for (let index = values.length - 1; index > 0; index--) {
      const swapIndex = this.rng.nextInt(0, index + 1);
      [values[index], values[swapIndex]] = [values[swapIndex], values[index]];
    }
    return values;
  }
}

function cloneRoom(room: GeneratedRoom): GeneratedRoom {
  return {
    ...room,
    bounds: { ...room.bounds },
    footprint: room.footprint.map((point) => ({ ...point })),
    capabilities: [...room.capabilities],
    // Gameplay roles are recomputed by this stage; stale prior assignments
    // must not leak into a fresh deterministic placement run.
    specialRoles: [],
  };
}
