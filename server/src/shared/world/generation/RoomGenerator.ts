import { PRNG } from "../../PRNG.js";
import type { MapGenerationConfig } from "./config/MapGenerationConfig.js";
import type {
  GeneratedRoom,
  RoomCapability,
  RoomGenerationRules,
  RoomRosterEntry,
} from "./types/RoomTypes.js";
import type { TilePoint, TileRect } from "./types/MapGeometry.js";

/**
 * Creates room footprints and places them on the map.
 *
 * Responsibilities:
 * - Select concrete room variants from RoomRoster using Weight.
 * - Generate geometry from each variant's Generation rules.
 * - Support RECTANGLE and L_SHAPED footprints.
 * - Prevent overlap and enforce minRoomSpacing.
 * - Return exactly roomsCount rooms, or throw a useful error.
 *
 * This class deliberately does not assign special roles, choose spawn rooms,
 * create connections, or place gameplay objects. Those are later pipeline stages.
 */
export class RoomGenerator {
  private readonly width: number;
  private readonly height: number;
  private readonly roomsCount: number;
  private readonly minRoomSpacing: number;
  private readonly roster: readonly RoomRosterEntry[];
  private readonly ordinaryRoster: readonly RoomRosterEntry[];

  /** Actual occupied room tiles. */
  private readonly occupied: Uint8Array;

  private readonly minMapMargin = 1;

  private readonly maxTemplateAttemptsPerRoom = 160;
  private readonly positionSamplesPerCandidate = 90;

  constructor(
    private readonly config: MapGenerationConfig,
    private readonly rng: PRNG,
  ) {
    this.width = config.width;
    this.height = config.height;
    this.roomsCount = config.roomsCount;
    this.minRoomSpacing = config.connectivity.minRoomSpacing;
    this.roster = config.roomRoster;
    // ReservedOnly templates are available for capability reservations, but
    // are excluded from ordinary weighted room selection.
    this.ordinaryRoster = this.roster.filter((entry) => entry.ReservedOnly !== true);

    this.occupied = new Uint8Array(this.width * this.height);

    this.assertUsableConfiguration();
  }

  /**
   * Generates exactly config.roomsCount rooms.
   *
   * Failure is explicit: the requested count is never silently reduced.
   */
  public generate(): GeneratedRoom[] {
    const rooms: GeneratedRoom[] = [];

    // Reserve enough eligible room instances for the hard gameplay roles that
    // will be assigned later by GameplayPlacementGenerator. These are only
    // eligibility reservations; specialRoles remain empty at this stage.
    const requiredSlots = this.createRequiredRoomSlots();

    // Place room categories with the largest eligible templates first. This
    // reduces the chance that small rooms consume space needed by large rooms.
    requiredSlots.sort(
      (a, b) => this.getLargestMinimumArea(b) - this.getLargestMinimumArea(a),
    );

    for (const capability of requiredSlots) {
      const eligibleTemplates = this.roster.filter((entry) =>
        entry.Capabilities.includes(capability),
      );

      if (eligibleTemplates.length === 0) {
        throw new Error(
          `RoomGenerator: no RoomRoster template provides required capability '${capability}'.`,
        );
      }

      const room = this.tryPlaceRoom(eligibleTemplates, rooms);
      if (!room) {
        throw new Error(
          `RoomGenerator could not reserve a room with capability '${capability}'. ` +
          `Check its template dimensions, map size, and minRoomSpacing (${this.minRoomSpacing}).`,
        );
      }

      rooms.push(room);
    }

    // Fill the remaining slots using only templates that are not reserved-only.
    if (rooms.length < this.roomsCount && this.ordinaryRoster.length === 0) {
      throw new Error(
        "RoomGenerator: all RoomRoster templates are ReservedOnly, but ordinary room slots remain. " +
        "Add at least one template without ReservedOnly: true, or increase the reserved room counts.",
      );
    }

    while (rooms.length < this.roomsCount) {
      const room = this.tryPlaceRoom(this.ordinaryRoster, rooms);

      if (!room) {
        throw new Error(
          `RoomGenerator could place only ${rooms.length} of ${this.roomsCount} ` +
          `requested rooms on a ${this.width}x${this.height} map. ` +
          `Check room dimensions, roster weights, and minRoomSpacing ` +
          `(${this.minRoomSpacing}).`,
        );
      }

      rooms.push(room);
    }

    return rooms;
  }

  /**
   * Builds the required eligible room slots from the gameplay configuration.
   * Ritual, player-spawn and monster-spawn slots are kept separate so a single
   * room cannot accidentally satisfy two mutually exclusive placement roles.
   */
  private createRequiredRoomSlots(): RoomCapability[] {
    const slots: RoomCapability[] = [];
    const playerRoomCount = Math.ceil(
      this.config.playerCount / this.config.spawns.playerSpawnRoomCapacity,
    );

    for (let i = 0; i < this.config.objectives.ritualRoomCount; i++) {
      slots.push("RITUAL_ELIGIBLE");
    }

    for (let i = 0; i < playerRoomCount; i++) {
      slots.push("PLAYER_SPAWN_ELIGIBLE");
    }

    for (let i = 0; i < this.config.spawns.monsterSpawnRoomCount; i++) {
      slots.push("MONSTER_SPAWN_ELIGIBLE");
    }

    if (slots.length > this.roomsCount) {
      throw new Error(
        `RoomGenerator requires at least ${slots.length} rooms to reserve ` +
        `Ritual and spawn candidates, but roomsCount is ${this.roomsCount}.`,
      );
    }

    return slots;
  }

  /** Largest minimum footprint area among templates providing a capability. */
  private getLargestMinimumArea(capability: RoomCapability): number {
    return this.roster
      .filter((entry) => entry.Capabilities.includes(capability))
      .reduce(
        (largest, entry) =>
          Math.max(
            largest,
            entry.Generation.minWidth * entry.Generation.minHeight,
          ),
        0,
      );
  }

  /** Attempts to place one room, sampling only from the supplied template pool. */
  private tryPlaceRoom(
    templatePool: readonly RoomRosterEntry[],
    placedRooms: GeneratedRoom[],
  ): GeneratedRoom | undefined {
    for (let attempt = 0; attempt < this.maxTemplateAttemptsPerRoom; attempt++) {
      const template = this.pickWeightedTemplate(templatePool);
      const shape = this.createShape(template.Generation);
      if (!shape) continue;

      const position = this.findPlacement(shape, placedRooms);
      if (!position) continue;

      const footprint = shape.localFootprint.map((point) => ({
        x: point.x + position.x,
        y: point.y + position.y,
      }));

      const bounds: TileRect = {
        x: position.x,
        y: position.y,
        width: shape.width,
        height: shape.height,
      };

      const room: GeneratedRoom = {
        id: placedRooms.length + 1,
        templateId: template.Room,
        type: template.Type,
        shape: template.Generation.shape,
        bounds,
        footprint,
        capabilities: [...template.Capabilities],
        specialRoles: [],
      };

      this.reserveFootprint(footprint);
      return room;
    }

    return undefined;
  }

  private assertUsableConfiguration(): void {
    if (!Number.isInteger(this.width) || this.width < 3) {
      throw new Error("RoomGenerator: map width must be an integer >= 3.");
    }
    if (!Number.isInteger(this.height) || this.height < 3) {
      throw new Error("RoomGenerator: map height must be an integer >= 3.");
    }
    if (!Number.isInteger(this.roomsCount) || this.roomsCount < 1) {
      throw new Error("RoomGenerator: roomsCount must be a positive integer.");
    }
    if (
      !Number.isInteger(this.minRoomSpacing) ||
      this.minRoomSpacing < 0
    ) {
      throw new Error("RoomGenerator: minRoomSpacing must be a non-negative integer.");
    }
    if (this.roster.length === 0) {
      throw new Error("RoomGenerator: RoomRoster cannot be empty.");
    }

    const ids = new Set<string>();
    let totalWeight = 0;

    for (const entry of this.roster) {
      if (!entry.Room.trim()) {
        throw new Error("RoomGenerator: room template identifiers cannot be empty.");
      }
      if (ids.has(entry.Room)) {
        throw new Error(`RoomGenerator: duplicate room template '${entry.Room}'.`);
      }
      ids.add(entry.Room);

      if (!Number.isFinite(entry.Weight) || entry.Weight <= 0) {
        throw new Error(
          `RoomGenerator: '${entry.Room}' must have a finite Weight greater than zero.`,
        );
      }
      if (entry.ReservedOnly !== undefined && typeof entry.ReservedOnly !== "boolean") {
        throw new Error(
          `RoomGenerator: '${entry.Room}'.ReservedOnly must be a boolean when provided.`,
        );
      }
      totalWeight += entry.Weight;

      this.validateGenerationRules(entry.Room, entry.Generation);
    }

    if (!Number.isFinite(totalWeight) || totalWeight <= 0) {
      throw new Error("RoomGenerator: RoomRoster total weight must be positive and finite.");
    }

    if (this.width <= this.minMapMargin * 2 || this.height <= this.minMapMargin * 2) {
      throw new Error("RoomGenerator: map is too small for the configured outer margin.");
    }
  }

  private validateGenerationRules(
    roomName: string,
    rules: RoomGenerationRules,
  ): void {
    const validateRange = (
      min: number,
      max: number,
      label: string,
    ): void => {
      if (!Number.isInteger(min) || !Number.isInteger(max) || min < 1 || max < min) {
        throw new Error(
          `RoomGenerator: invalid ${label} range for '${roomName}'.`,
        );
      }
    };

    validateRange(rules.minWidth, rules.maxWidth, "width");
    validateRange(rules.minHeight, rules.maxHeight, "height");

    if (rules.shape !== "RECTANGLE" && rules.shape !== "L_SHAPED") {
      throw new Error(`RoomGenerator: unsupported shape for '${roomName}'.`);
    }

    if (
      rules.orientation !== undefined &&
      rules.orientation !== "ANY" &&
      rules.orientation !== "HORIZONTAL" &&
      rules.orientation !== "VERTICAL"
    ) {
      throw new Error(`RoomGenerator: invalid orientation for '${roomName}'.`);
    }

    if (rules.shape === "L_SHAPED") {
      const minThickness = rules.minArmThickness ?? 2;
      const maxThickness = rules.maxArmThickness ?? minThickness;

      if (
        !Number.isInteger(minThickness) ||
        !Number.isInteger(maxThickness) ||
        minThickness < 1 ||
        maxThickness < minThickness
      ) {
        throw new Error(`RoomGenerator: invalid arm thickness range for '${roomName}'.`);
      }
    }
  }

  private pickWeightedTemplate(
    templatePool: readonly RoomRosterEntry[],
  ): RoomRosterEntry {
    const totalWeight = templatePool.reduce(
      (sum, entry) => sum + entry.Weight,
      0,
    );

    let roll = this.rng.next() * totalWeight;

    for (const entry of templatePool) {
      roll -= entry.Weight;
      if (roll < 0) return entry;
    }

    // Floating-point rounding fallback.
    return templatePool[templatePool.length - 1];
  }

  private createShape(
    rules: RoomGenerationRules,
  ): { width: number; height: number; localFootprint: TilePoint[] } | undefined {
    const dimensions = this.sampleDimensions(rules);
    if (!dimensions) return undefined;

    const { width, height } = dimensions;

    if (rules.shape === "RECTANGLE") {
      return {
        width,
        height,
        localFootprint: this.createRectangleFootprint(width, height),
      };
    }

    const minArmThickness = rules.minArmThickness ?? 2;
    const maxArmThickness = Math.min(
      rules.maxArmThickness ?? minArmThickness,
      width,
      height,
    );

    if (maxArmThickness < minArmThickness) return undefined;

    const armThickness = randomIntInclusive(
      this.rng,
      minArmThickness,
      maxArmThickness,
    );

    const corner = this.rng.nextInt(0, 4);
    const localFootprint: TilePoint[] = [];

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const inHorizontalArm =
          corner <= 1 ? y < armThickness : y >= height - armThickness;
        const inVerticalArm =
          corner === 0 || corner === 2
            ? x < armThickness
            : x >= width - armThickness;

        if (inHorizontalArm || inVerticalArm) {
          localFootprint.push({ x, y });
        }
      }
    }

    return { width, height, localFootprint };
  }

  private sampleDimensions(
    rules: RoomGenerationRules,
  ): { width: number; height: number } | undefined {
    const availableWidth = this.width - this.minMapMargin * 2;
    const availableHeight = this.height - this.minMapMargin * 2;

    const minWidth = rules.minWidth;
    const maxWidth = Math.min(rules.maxWidth, availableWidth);
    const minHeight = rules.minHeight;
    const maxHeight = Math.min(rules.maxHeight, availableHeight);

    if (maxWidth < minWidth || maxHeight < minHeight) return undefined;

    if (rules.orientation === "HORIZONTAL") {
      const feasibleMaxHeight = Math.min(maxHeight, maxWidth);
      if (feasibleMaxHeight < minHeight) return undefined;

      const height = randomIntInclusive(
        this.rng,
        minHeight,
        feasibleMaxHeight,
      );
      const feasibleMinWidth = Math.max(minWidth, height);
      const width = randomIntInclusive(
        this.rng,
        feasibleMinWidth,
        maxWidth,
      );
      return { width, height };
    }

    if (rules.orientation === "VERTICAL") {
      const feasibleMaxWidth = Math.min(maxWidth, maxHeight);
      if (feasibleMaxWidth < minWidth) return undefined;

      const width = randomIntInclusive(
        this.rng,
        minWidth,
        feasibleMaxWidth,
      );
      const feasibleMinHeight = Math.max(minHeight, width);
      const height = randomIntInclusive(
        this.rng,
        feasibleMinHeight,
        maxHeight,
      );
      return { width, height };
    }

    return {
      width: randomIntInclusive(this.rng, minWidth, maxWidth),
      height: randomIntInclusive(this.rng, minHeight, maxHeight),
    };
  }

  private createRectangleFootprint(
    width: number,
    height: number,
  ): TilePoint[] {
    const footprint: TilePoint[] = [];

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        footprint.push({ x, y });
      }
    }

    return footprint;
  }

  private findPlacement(
    shape: { width: number; height: number; localFootprint: TilePoint[] },
    placedRooms: GeneratedRoom[],
  ): TilePoint | undefined {
    const minX = this.minMapMargin;
    const minY = this.minMapMargin;
    const maxX = this.width - this.minMapMargin - shape.width;
    const maxY = this.height - this.minMapMargin - shape.height;

    if (maxX < minX || maxY < minY) return undefined;

    let best: TilePoint | undefined;
    let bestScore = Number.NEGATIVE_INFINITY;

    const consider = (x: number, y: number): void => {
      if (!this.canPlace(shape.localFootprint, x, y)) return;

      const score = this.scorePlacement(
        x,
        y,
        shape.width,
        shape.height,
        placedRooms,
      );

      if (score > bestScore) {
        best = { x, y };
        bestScore = score;
      }
    };

    for (let sample = 0; sample < this.positionSamplesPerCandidate; sample++) {
      consider(
        randomIntInclusive(this.rng, minX, maxX),
        randomIntInclusive(this.rng, minY, maxY),
      );
    }

    // Exhaustive fallback avoids false failures when random samples miss a
    // narrow remaining placement pocket. It is bounded by the map dimensions.
    if (!best) {
      for (let y = minY; y <= maxY; y++) {
        for (let x = minX; x <= maxX; x++) {
          consider(x, y);
        }
      }
    }

    return best;
  }

  private canPlace(
    localFootprint: TilePoint[],
    originX: number,
    originY: number,
  ): boolean {
    const spacing = this.minRoomSpacing;

    for (const localPoint of localFootprint) {
      const x = originX + localPoint.x;
      const y = originY + localPoint.y;

      if (
        x < this.minMapMargin ||
        x >= this.width - this.minMapMargin ||
        y < this.minMapMargin ||
        y >= this.height - this.minMapMargin
      ) {
        return false;
      }

      for (let dy = -spacing; dy <= spacing; dy++) {
        for (let dx = -spacing; dx <= spacing; dx++) {
          const nx = x + dx;
          const ny = y + dy;

          if (nx < 0 || nx >= this.width || ny < 0 || ny >= this.height) {
            continue;
          }

          if (this.occupied[ny * this.width + nx] !== 0) {
            return false;
          }
        }
      }
    }

    return true;
  }

  private reserveFootprint(footprint: TilePoint[]): void {
    for (const point of footprint) {
      this.occupied[point.y * this.width + point.x] = 1;
    }
  }

  /**
   * Prefers positions that keep the rooms distributed across the available
   * map area. The score is based on the nearest existing room center, with a
   * slight seeded jitter to avoid deterministic geometric regularity.
   */
  private scorePlacement(
    x: number,
    y: number,
    width: number,
    height: number,
    placedRooms: GeneratedRoom[],
  ): number {
    const centerX = x + (width - 1) / 2;
    const centerY = y + (height - 1) / 2;

    if (placedRooms.length === 0) {
      const mapCenterX = (this.width - 1) / 2;
      const mapCenterY = (this.height - 1) / 2;
      const distanceFromCenter = Math.hypot(
        centerX - mapCenterX,
        centerY - mapCenterY,
      );

      // Keep the first room near the central area, but not at one fixed point.
      return -distanceFromCenter + this.rng.next() * 2;
    }

    let nearestDistance = Number.POSITIVE_INFINITY;

    for (const room of placedRooms) {
      const roomCenterX = room.bounds.x + (room.bounds.width - 1) / 2;
      const roomCenterY = room.bounds.y + (room.bounds.height - 1) / 2;
      const distance = Math.hypot(
        centerX - roomCenterX,
        centerY - roomCenterY,
      );
      nearestDistance = Math.min(nearestDistance, distance);
    }

    return nearestDistance + this.rng.next() * 2;
  }
}

function randomIntInclusive(
  rng: PRNG,
  min: number,
  max: number,
): number {
  if (max < min) {
    throw new Error(`Invalid random integer range: ${min}..${max}.`);
  }
  return rng.nextInt(min, max + 1);
}
