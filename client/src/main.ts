import {
  GAME_VERSION,
  TILEMAP_UPSCALE,
  USE_LOCALHOST,
} from "./shared/constants.js";
import {
  Application,
  Assets,
  BlurFilter,
  ColorMatrixFilter,
  Container,
  Filter,
  Graphics,
  isMobile,
  Rectangle,
  Sprite,
  Text,
  TextStyle,
  Texture,
  TextureStyle,
  Ticker,
} from "pixi.js";
import { connectToGame, GameNetwork } from "./network";
import { DebugUI } from "./ui/DebugUI.js";
import { getMoveX, getMoveY, isInteractKeyPressed } from "./input.js";
import { Callbacks } from "@colyseus/sdk";
import { PROXY_URL } from "./shared/constants.js";
import { Player, WorldInfo } from "./shared/schema/MyRoomState.js";
import { WorldMap } from "./shared/world/WorldMap.js";
import { loadMapData } from "./shared/world/utils/load.js";
import { GeneratedGameplayObject as GameplayObject } from "./shared/world/generation/types/GameplayTypes.js";
import { GeneratedRoom } from "./shared/world/generation/types/RoomTypes.js";
import { TILE_HEIGHT, TILE_WIDTH } from "./shared/world/MapGeometry.js";
import { VisionRenderer } from "./render/VisionRenderer.js";
import { SimulationEngine } from "./shared/simulation/SimulationEngine.js";
import { RenderSystem } from "./render/RenderSystem.js";
import {
  TransformComponent,
  VelocityComponent,
  SightComponent,
} from "./shared/simulation/components.js";
import { CRTFilter, RGBSplitFilter } from "pixi-filters";
import gsap from "gsap";

const debugUI = new DebugUI();

const clientEngine = new SimulationEngine();

async function updateUptime() {
  if (USE_LOCALHOST && import.meta.env.DEV) return;
  try {
    const response = await fetch(`${PROXY_URL}/get-uptime`);
    const data = await response.json();

    if (data.remainingSeconds !== undefined) {
      // Format as MM:SS
      const minutes = Math.floor(data.remainingSeconds / 60);
      const seconds = data.remainingSeconds % 60;
      const timeString = `${minutes}:${seconds.toString().padStart(2, "0")}`;
      debugUI.updateField("Uptime", timeString);
    }
  } catch (err) {
    debugUI.updateField("Uptime", "Error: " + err);
  }
}

let currentWorldId = "";
let currentWorldMap: WorldMap;

const cameraContainer: Container = new Container();
cameraContainer.sortableChildren = true;

const playerContainer: Container = new Container();
playerContainer.sortableChildren = true;
const debugContainer: Container = new Container();

const fogContainer = new Container();

let fogTexture: Texture;
let fogSprite: Sprite;

const resizeFogSprite = (t: number = 0) => {
  if (!fogTexture)
    return;
  const width = window.innerWidth;
  const height = window.innerHeight;

  const targetWidth = width + 150 + ((1 + Math.cos(t / 4000)) * width) / 16;
  const targetHeight = height + 150 + ((1 + Math.sin(t / 3000)) * height) / 16;

  // const scale = Math.max(
  //     targetWidth / fogTexture.width,
  //     targetHeight / fogTexture.height
  // );
  const scaleX = targetWidth / fogTexture.width;
  const scaleY = targetHeight / fogTexture.height;

  fogSprite.scale.set(scaleX, scaleY);
};
resizeFogSprite();

const visionRenderer = new VisionRenderer(fogContainer);
const visionGraphics = visionRenderer.getGraphics();
visionGraphics.blendMode = "erase";

let copyContainers: Container[] = [];

// FILTERS INIT
const crtFilter = new CRTFilter({ curvature: 10 });
const rbgSplitFilter = new RGBSplitFilter({
  red: { x: -5, y: 0 },
  green: { x: 0, y: 5 },
});
const desaturateFilter = new ColorMatrixFilter();
desaturateFilter.desaturate();
const darkFilter = new ColorMatrixFilter();
darkFilter.brightness(0.5, true);
const blurFilter = new BlurFilter({
  strength: 2,
  padding: 2,
  clipToViewport: true,
});

fogContainer.filters = [blurFilter, rbgSplitFilter, darkFilter];

cameraContainer.filters = [crtFilter];

const copyContainerFilters: Filter[] = [desaturateFilter];

const guiContainer = new Container();
const loadingGuiContainer = new Container();
loadingGuiContainer.zIndex = 100000;
guiContainer.addChild(loadingGuiContainer);

const leftBorder = new Graphics();
const rightBorder = new Graphics();
const loadingText = new Text({
  text: "",
  style: { fill: "#efefef", fontSize: 24, fontFamily: "Consolas,Arial" },
});
const loadingTextTitle = new Text({
  text: "",
  style: { fill: "#ffffff", fontSize: 64, fontFamily: "Consolas,Arial" },
});

loadingGuiContainer.addChild(
  leftBorder,
  rightBorder,
  loadingText,
  loadingTextTitle,
);
loadingGuiContainer.visible = false;

function startLoadingScreen(worldId: string): void {
  gsap.killTweensOf([leftBorder, rightBorder, loadingText, loadingTextTitle]);

  leftBorder
    .clear()
    .rect(0, 0, window.innerWidth / 2, window.innerHeight)
    .fill(0x000000);
  rightBorder
    .clear()
    .rect(0, 0, window.innerWidth / 2, window.innerHeight)
    .fill(0x000000);

  leftBorder.x = -window.innerWidth / 2;
  rightBorder.x = window.innerWidth;
  loadingText.text = "Traversing to...";
  loadingText.anchor.set(0.5);
  loadingText.position.set(window.innerWidth / 2, window.innerHeight / 2 - 64);
  loadingText.alpha = 0;

  loadingTextTitle.text = worldId.toUpperCase();
  loadingTextTitle.anchor.set(0.5);
  loadingTextTitle.position.set(window.innerWidth / 2, window.innerHeight / 2);
  loadingTextTitle.alpha = 0;

  loadingGuiContainer.visible = true;

  gsap.to(leftBorder, { x: 0, duration: 0.2, ease: "power2.inOut" });
  gsap.to(rightBorder, {
    x: window.innerWidth / 2,
    duration: 0.2,
    ease: "power2.inOut",
  });
  gsap.to(loadingText, { alpha: 1, delay: 0.125, duration: 0.5 });
  gsap.to(loadingTextTitle, { alpha: 1, delay: 0.25, duration: 0.5 });
}

function stopLoadingScreen(): void {
  gsap.killTweensOf([leftBorder, rightBorder, loadingText, loadingTextTitle]);

  const width = window.innerWidth;

  gsap
    .timeline({
      onComplete: () => {
        loadingGuiContainer.visible = false;

        // Reset positions for the next transition.
        leftBorder.x = -width / 2;
        rightBorder.x = width;
        loadingText.alpha = 0;
        loadingTextTitle.alpha = 0;
      },
    })
    .to(
      leftBorder,
      {
        x: -width / 2,
        duration: 0.45,
        ease: "power3.in",
      },
      0,
    )
    .to(
      rightBorder,
      {
        x: width,
        duration: 0.45,
        ease: "power3.in",
      },
      0,
    )
    .to(
      loadingText,
      {
        alpha: 0,
        duration: 0.2,
        ease: "power2.in",
      },
      0,
    )
    .to(
      loadingTextTitle,
      {
        alpha: 0,
        duration: 0.5,
        ease: "power2.in",
      },
      0,
    );
}

async function initGame(app: Application, net: GameNetwork) {
  const { room, predict, input } = net;

  console.log("Successfully connected to the game room", room.roomId);
  debugUI.updateField("Room", room.roomId);
  debugUI.updateField("PlayerID", room.sessionId);

  const worldId = room.state.players.get(room.sessionId)?.worldId;
  const worldInfo = room.state.worlds.get(worldId!);

  if (!worldInfo) {
    console.error("No world info found for player!");
    return;
  }

  // 2. NOW the world exists! Setup player callbacks safely.
  const callbacks = Callbacks.get(room);

  const spawnPlayerEntity = (player: Player, sessionId: string) => {
    const world = clientEngine.getWorld(currentWorldId);
    if (!world) return;

    const isMe = sessionId === room.sessionId;
    clientEngine.createPlayerEntity(
      currentWorldId,
      sessionId,
      player.x,
      player.y,
    );

    if (isMe) {
      //entity.addComponent(new SightComponent(120, 361, 0));
      callbacks.listen(player, "isHidden", (isHidden: boolean) => {
        console.log(isHidden ? "You are hiding." : "You left the closet.");
      });
    }
  };

  const removePlayerEntity = (player: Player, sessionId: string) => {
    clientEngine.removePlayer(player.worldId, sessionId);
  };

  // 4. Listen for FUTURE players
  callbacks.onAdd("players", spawnPlayerEntity);
  callbacks.onRemove("players", removePlayerEntity);

  // World Id syncing
  const syncPlayerWorld = (player: Player, sessionId: string) => {
    const world = clientEngine.getWorld(currentWorldId);
    if (!world) return;

    const existingEntity = world.playerEntities.get(sessionId);

    if (player.worldId !== currentWorldId) {
      if (existingEntity) {
        removePlayerEntity(player, sessionId);
      }
      return;
    }

    if (!existingEntity) {
      spawnPlayerEntity(player, sessionId);
    }
  };
  callbacks.onAdd("players", (player: Player, sessionId: string) => {
    callbacks.listen(player, "worldId", () => {
      syncPlayerWorld(player, sessionId);
    });
    syncPlayerWorld(player, sessionId);
  });

  const updatePlayerList = () => {
    const playerIds = Array.from(room.state.players.keys());
    const shortIds = playerIds.map((id: string) => id.substring(0, 4));

    const displayString = `${playerIds.length} [${shortIds.join(", ")}]`;

    debugUI.updateField("Players", displayString);
  };

  callbacks.onAdd("players", () => updatePlayerList());
  callbacks.onRemove("players", () => updatePlayerList());
  updatePlayerList();

  room.onMessage("moveToWorld", async ({ worldInfo, worldId }) => {
    console.log("To", worldId, "from", currentWorldId);
    if (worldId === currentWorldId) return;

    console.log("Traversing...");
    startLoadingScreen(worldId);

    await new Promise<void>((resolve) => setTimeout(resolve, 500));

    room.state.players.forEach((player, sessionId) => {
      removePlayerEntity(player, sessionId);
    });
    clientEngine.removeWorld(currentWorldId);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    currentWorldId = worldId;

    const newWorldMap = await loadFromWorldInfo(app, worldInfo);
    if (!newWorldMap) return;

    console.log("Transitioning to world:", worldId);
    currentWorldMap = newWorldMap;

    room.state.players.forEach((player, sessionId) => {
      if (player.worldId === currentWorldId || sessionId === room.sessionId) {
        spawnPlayerEntity(player, sessionId);
      }
    });

    await new Promise<void>((resolve) => setTimeout(resolve, 100));
    stopLoadingScreen();
  });

  // Listen to the phase changing
  callbacks.listen("phase", (newPhase: string) => {
    //console.log("Phase changed to:", newPhase);
    debugUI.updateField("Phase", newPhase.toUpperCase());
  });

  // Listen to the timer
  callbacks.listen("phaseTimer", (timeRemaining: number) => {
    debugUI.updateField("Timer", `${timeRemaining}s`);
  });

  setInterval(() => {
    room.ping((ms: number) => {
      debugUI.updateField("Ping", `${ms}ms`);
    });
  }, 1000);

  setInterval(updateUptime, 15000);
  updateUptime();

  let mouseX: number;
  let mouseY: number;
  const mouseRay = new Graphics();
  debugContainer.addChild(mouseRay);

  document.addEventListener(
    "mousemove",
    (ev: MouseEvent) => {
      mouseX = ev.pageX;
      mouseY = ev.pageY;
    },
    false,
  );

  // WAIT for the map to load AND the SimulationEngine world to be created.
  const loadedMapData = await loadMapData(worldInfo);
  currentWorldMap = loadedMapData.worldMap!;
  currentWorldId = worldId ?? "";

  await loadFromWorldMap(
    app,
    currentWorldMap,
    loadedMapData.gameplayObjects,
    loadedMapData.generatedRooms,
  );

  // Manually spawn players who are ALREADY in the room
  room.state.players.forEach((player, sessionId) => {
    spawnPlayerEntity(player, sessionId);
  });

  app.ticker.add((ticker: Ticker) => {
    const now = performance.now();
    const steps = predict.tick(now);
    const deltaTime = Math.min(0.1, ticker.deltaMS / 1000);

    const world = clientEngine.getWorld(currentWorldId);
    if (!world) return;

    // console.dir(world, { depth: 5 });

    const localPlayerSchema = room.state.players.get(room.sessionId);
    const localEntity = world.playerEntities.get(room.sessionId);

    // ==========================================
    // 1. APPLY LOCAL INPUT (Prediction)
    // ==========================================
    if (localPlayerSchema && localEntity) {
      for (let i = 0; i < steps; i++) {
        const moveX = getMoveX(); // -1, 0, 1
        const moveY = getMoveY();

        input.data.moveX = moveX;
        input.data.moveY = moveY;
        input.data.interact = isInteractKeyPressed();
        input.send();

        // Feed input directly into the ECS entity
        clientEngine.setPlayerInput(
          localPlayerSchema.worldId,
          room.sessionId,
          moveX,
          moveY,
        );

        // (Your locker interaction logic goes here, unchanged)
      }
    }

    // ==========================================
    // 1.1. UPDATE FILTERS
    // ==========================================
    crtFilter.time = app.ticker.lastTime / 2;
    rbgSplitFilter.red.x = (3 - Math.sin(app.ticker.lastTime / 8000)) / 2;
    rbgSplitFilter.green.y = -(3 - Math.cos(app.ticker.lastTime / 9000)) / 2;

    // ==========================================
    // 1.2. DRAW FOG
    // ==========================================
    resizeFogSprite(app.ticker.lastTime);

    if (localEntity) {
      const transform = localEntity.getComponent(TransformComponent);
      const sight = localEntity.getComponent(SightComponent);

      if (transform && sight) {
        // 1. Update sight direction based on movement or mouse (for testing)
        // (In a real game, update this based on where the player is aiming)

        // 2. Get all entities in the current world
        let allEntities =
          clientEngine
            .getWorld(currentWorldId)
            ?.scene.querySystem.queryAll(TransformComponent).entities || [];
        allEntities = allEntities.filter((ent) => ent.id !== localEntity.id);

        // 3. Draw the vision polygon
        visionRenderer.draw(
          currentWorldMap,
          transform.x, // Convert to screen pixels!
          transform.y,
          sight,
          allEntities,
        );

        // Apply upscaling to the mask as well
        visionRenderer.getGraphics().scale.set(TILEMAP_UPSCALE);
      }
    }

    // ==========================================
    // 2. SYNC REMOTE PLAYERS (Colyseus -> ECS)
    // ==========================================
    for (const [sessionId, playerSchema] of room.state.players) {
      if (sessionId === room.sessionId) continue; // Local player is predicted

      const entity = world.playerEntities.get(sessionId);
      if (!entity) continue;

      const transform = entity.getComponent(TransformComponent);
      const vel = entity.getComponent(VelocityComponent);

      if (transform && vel) {
        // We overwrite the ECS position with the server's position
        // To prevent snapping, we can lerp the ECS position towards the server position
        transform.x += (playerSchema.x - transform.x) * 0.3;
        transform.y += (playerSchema.y - transform.y) * 0.3;

        // Sync velocity (useful if you use it for animation or sight direction)
        vel.vx = playerSchema.vx;
        vel.vy = playerSchema.vy;
      }
    }

    // ==========================================
    // 3. SYNC LOCAL PLAYER (Reconciliation)
    // ==========================================
    if (localPlayerSchema && localEntity) {
      const transform = localEntity.getComponent(TransformComponent);
      if (transform) {
        // The server is the ultimate authority. We snap the ECS to the reconciled prediction position.
        transform.x = (predict.value(localPlayerSchema, "x") + transform.x) / 2;
        transform.y = (predict.value(localPlayerSchema, "y") + transform.y) / 2;
      }
    }

    // ==========================================
    // 4. TICK SIMULATION ENGINE
    // ==========================================
    // This runs MovementSystem (which applies wall collisions) and RenderSystem (which updates sprites)
    clientEngine.tick(deltaTime);

    // ==========================================
    // 5. CAMERA & UI (Unchanged)
    // ==========================================
    const localTransform = localEntity?.getComponent(TransformComponent);

    if (localTransform) {
      cameraContainer.x =
        window.innerWidth / 2 - localTransform.x * TILEMAP_UPSCALE;
      cameraContainer.y =
        window.innerHeight / 2 - localTransform.y * TILEMAP_UPSCALE;

      fogSprite.x = localTransform.x * TILEMAP_UPSCALE - 64;
      fogSprite.y = localTransform.y * TILEMAP_UPSCALE - 64;

      // MOUSE RAY
      if (
        currentWorldMap === undefined ||
        mouseX === undefined ||
        mouseY === undefined
      )
        return;

      const worldMouseX = mouseX - cameraContainer.x;
      const worldMouseY = mouseY - cameraContainer.y;

      let ray = currentWorldMap.raycast(
        localTransform.x,
        localTransform.y,
        worldMouseX / TILEMAP_UPSCALE,
        worldMouseY / TILEMAP_UPSCALE,
      );

      if (ray === null) {
        ray = { x: worldMouseX, y: worldMouseY };
      } else {
        ray.x *= TILEMAP_UPSCALE;
        ray.y *= TILEMAP_UPSCALE;
      }

      mouseRay
        .clear()
        .moveTo(
          localTransform.x * TILEMAP_UPSCALE,
          localTransform.y * TILEMAP_UPSCALE,
        )
        .lineTo(ray.x, ray.y)
        .stroke({ width: 2, color: 0x00ff00 });
    }
  });
}

async function renderMapData(
  worldMap: WorldMap,
  cameraContainer: Container,
  gameplayObjects?: GameplayObject[],
  generatedRooms: GeneratedRoom[] = [],
) {
  const mapData = worldMap.mapData;

  const tilesetInfo = mapData.tilesets[0];
  const baseTexture = await Assets.load(
    `assets/${tilesetInfo.source.split(".")[0]}.png`,
  );

  const objectContainer = new Container();

  for (const copyContainer of copyContainers) {
    copyContainer.destroy();
  }
  copyContainers = [];

  window.addEventListener("resize", () => {
    resizeFogSprite();
  });

  if (!gameplayObjects) gameplayObjects = [];

  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  for (const obj of gameplayObjects) {
    const pixelX =
      (obj.position.x + (obj.footprint?.width ?? 1) / 2) * 8 * TILEMAP_UPSCALE;
    const pixelY =
      (obj.position.y + (obj.footprint?.height ?? 1) / 2) * 8 * TILEMAP_UPSCALE;

    const g = new Graphics();
    let color = 0xffffff;
    if (obj.kind === "Chest") color = 0x00ff00; // Green
    if (obj.kind === "Ritual") color = 0xff00ff; // Purple
    if (obj.kind === "Closet") color = 0x0000ff; // Blue
    if (obj.kind === "Door") color = 0xff8800; // Orange
    if (obj.kind === "SpawnArea") color = 0xffff00; // Yellow

    // Draw a small square for the object
    g.rect(
      -4 * TILEMAP_UPSCALE,
      -4 * TILEMAP_UPSCALE,
      8 * TILEMAP_UPSCALE,
      8 * TILEMAP_UPSCALE,
    ).fill(color);
    g.x = pixelX;
    g.y = pixelY;

    const debug_g = new Graphics();

    const style = new TextStyle({
      fontFamily: "Consolas,Arial",
      fontSize: 12,
      fill: 0xffffff,
      lineHeight: 16,
      stroke: { color: 0x000000, width: 4 },
    });

    let text = "";
    for (const key of Object.keys(obj)) {
      const value: string = obj[key as keyof typeof obj]?.toString() ?? "";
      if (!value || value.startsWith("[")) continue;
      text += key + ": " + value + "\n";
    }

    const label = new Text({ text: text, style });
    label.resolution = 2;

    label.anchor.set(0.5, 1);
    label.y = -12;

    debug_g.addChild(label);

    g.eventMode = "dynamic";
    g.addEventListener("mouseover", () => {
      debug_g.visible = debugUI.isVisible();
    });
    g.addEventListener("mouseleave", () => {
      debug_g.visible = false;
    });

    debug_g.visible = false;
    g.addChild(debug_g);

    // Add to a container (e.g., a new `interactableContainer` or `tileContainer`)
    objectContainer.addChild(g);
  }
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  for (const room of generatedRooms) {
    const pixelX = room.bounds.x * TILE_WIDTH * TILEMAP_UPSCALE;
    const pixelY = room.bounds.y * TILE_HEIGHT * TILEMAP_UPSCALE;

    const g = new Graphics();
    const color = 0xffffff;

    // Draw a small square for the object
    g.rect(
      (TILE_WIDTH / 2) * TILEMAP_UPSCALE,
      (TILE_HEIGHT / 2) * TILEMAP_UPSCALE,
      (room.bounds.width - 1) * TILE_WIDTH * TILEMAP_UPSCALE,
      (room.bounds.height - 1) * TILE_HEIGHT * TILEMAP_UPSCALE,
    ).fill({ color, alpha: 0.0625 });
    g.x = pixelX;
    g.y = pixelY;

    const debug_g = new Graphics();

    const style = new TextStyle({
      fontFamily: "Consolas,Arial",
      fontSize: 12,
      fill: 0xffffff,
      lineHeight: 16,
      stroke: { color: 0x000000, width: 4 },
    });

    let text = "";
    for (const key of Object.keys(room)) {
      const value: string = room[key as keyof typeof room]?.toString() ?? "";
      if (!value || value.startsWith("[")) continue;
      text += key + ": " + value + "\n";
    }
    for (const key of Object.keys(room.bounds)) {
      const value: string =
        room.bounds[key as keyof typeof room.bounds]?.toString() ?? "";
      if (!value || value.startsWith("[")) continue;
      text += key + ": " + value + "\n";
    }

    const label = new Text({ text: text, style });
    label.resolution = 2;

    label.anchor.set(0.5, 1);
    label.y = -12;

    debug_g.addChild(label);

    g.eventMode = "dynamic";
    g.addEventListener("mouseover", () => {
      debug_g.visible = debugUI.isVisible();
    });
    g.addEventListener("mouseleave", () => {
      debug_g.visible = false;
    });

    debug_g.visible = false;
    g.addChild(debug_g);

    // Add to a container (e.g., a new `interactableContainer` or `tileContainer`)
    objectContainer.addChildAt(g, 0);
  }

  const renderScale = TILEMAP_UPSCALE;

  const tileTextures: Record<number, Texture> = {};
  const cols = Math.floor(baseTexture.width / mapData.tilewidth);
  const rows = Math.floor(baseTexture.height / mapData.tileheight);

  let gid = tilesetInfo.firstgid || 1;
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const frame = new Rectangle(
        col * (mapData.tilewidth + 1),
        row * (mapData.tileheight + 1),
        mapData.tilewidth,
        mapData.tileheight,
      );
      tileTextures[gid] = new Texture({ source: baseTexture.source, frame });
      gid++;
    }
  }

  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  for (const layer of mapData.layers) {
    if (layer.type !== "tilelayer" || !layer.visible || !layer.data) continue;
    //console.log(layer);

    const layerContainer = new Container();
    layerContainer.alpha = layer.opacity ?? 1;

    let copyContainer: Container | undefined = undefined;

    if (layer.name === "wall") {
      copyContainer = new Container();
      copyContainer.alpha = layerContainer.alpha;
      copyContainer.filters = copyContainerFilters;

      copyContainers.push(copyContainer);
    }

    for (let i = 0; i < layer.data.length; i++) {
      const rawGid = layer.data[i];
      if (rawGid === 0) continue;

      // Strip Tiled's bitmask flags (horizontal/vertical/diagonal flips)
      const cleanGid = rawGid & ~(FLIP_D | FLIP_H | FLIP_V);
      const texture = tileTextures[cleanGid];

      if (texture) {
        const getSprite = (): Sprite => {
          const sprite = new Sprite(texture);
          sprite.anchor = 0.5;
          sprite.width *= renderScale;
          sprite.height *= renderScale;
          const col = i % (layer.width ?? 10);
          const row = Math.floor(i / (layer.width ?? 10));

          const flipH = (rawGid & FLIP_H) !== 0 ? 1 : 0;
          const flipV = (rawGid & FLIP_V) !== 0 ? 1 : 0;
          const flipD = (rawGid & FLIP_D) !== 0 ? 1 : 0;

          if (flipD) {
            sprite.rotation = Math.PI / 2;
            // Because PixiJS rotates first and scales second,
            // Tiled's horizontal flip becomes vertical scale, and vertical flip becomes inverted horizontal scale
            sprite.scale.x *= flipV ? -1 : 1;
            sprite.scale.y *= flipH ? 1 : -1;
          } else {
            sprite.scale.x *= flipH ? -1 : 1;
            sprite.scale.y *= flipV ? -1 : 1;
          }

          sprite.x = (col + 0.5) * mapData.tilewidth * renderScale;
          sprite.y = (row + 0.5) * mapData.tileheight * renderScale;
          return sprite;
        };

        layerContainer.addChild(getSprite());
        if (copyContainer) {
          const sprite = getSprite();
          sprite.scale.x += 0.1;
          sprite.scale.y += 0.1;
          copyContainer.addChild(sprite);
        }
      }
    }

    if (
      layer.properties?.find((prop) => prop.name == "Background")?.value !==
      true
    ) {
      try {
        cameraContainer.getChildIndex(playerContainer);
      } catch {
        cameraContainer.addChild(objectContainer);
        cameraContainer.addChild(debugContainer);
        cameraContainer.addChild(playerContainer);
      }
    }

    // Optimize static layers by caching them as a single texture
    layerContainer.cacheAsTexture(true);
    cameraContainer.addChild(layerContainer);
  }
  cameraContainer.addChild(fogContainer);
  for (const copyContainer of copyContainers) {
    fogContainer.addChildAt(copyContainer, 1);
  }
}

// TILEMAP INIT
async function loadFromWorldInfo(app: Application, worldInfo: WorldInfo) {
  const { worldMap, gameplayObjects, generatedRooms } =
    await loadMapData(worldInfo);
  if (!worldMap) return;

  return loadFromWorldMap(app, worldMap, gameplayObjects, generatedRooms);
}

async function loadFromWorldMap(
  app: Application,
  worldMap: WorldMap,
  gameplayObjects?: GameplayObject[],
  generatedRooms: GeneratedRoom[] = [],
) {
  generatedRooms = generatedRooms ?? [];

  cameraContainer.removeChildren();

  app.stage.addChildAt(cameraContainer, 0);
  if (!app.stage.children.find((v) => v === guiContainer)) {
    app.stage.addChild(guiContainer);
  }
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  await renderMapData(
    worldMap,
    cameraContainer,
    gameplayObjects,
    generatedRooms,
  );

  const tryWorld = clientEngine.getWorld(currentWorldId);
  if (!tryWorld) clientEngine.createWorld(currentWorldId, worldMap);
  // Add the Client-specific Render System
  const renderSystem = new RenderSystem();
  renderSystem.setStage(playerContainer);
  clientEngine.getWorld(currentWorldId)!.scene.addSystem(renderSystem);

  return worldMap;
}

TextureStyle.defaultOptions.scaleMode = "nearest";

const FLIP_H = 0x80000000;
const FLIP_V = 0x40000000;
const FLIP_D = 0x20000000;

(async () => {
  const app = new Application();

  await app.init({ background: "#1099bb", resizeTo: window });
  
  fogTexture = await Assets.load<Texture>(
    "assets/sprites/vfx/bg/eyesbg_noise.png",
  );
  fogSprite = new Sprite(fogTexture);
  fogSprite.anchor = 0.5;
  fogContainer.addChild(fogSprite);

  document.getElementById("pixi-container")!.appendChild(app.canvas);
  debugUI.addField("Version", GAME_VERSION);
  debugUI.addField("FPS", "");
  debugUI.addField("Room", "connecting...");
  debugUI.addField("Phase", "connecting...");
  debugUI.addField("Timer", "0s");
  debugUI.addField("Ping", "");
  debugUI.addField("Uptime", "");
  debugUI.addField("PlayerID", "");
  debugUI.addField("Position", "");
  debugUI.addField("Velocity", "");
  debugUI.addField("ServerPos", "");
  debugUI.addField("Players", "");

  if (!isMobile.any) {
    debugUI.addInputField("FPS Cap", 0, (val) => {
      const newCap = parseInt(val, 10);
      if (!isNaN(newCap) && newCap > 0) {
        app.ticker.maxFPS = newCap;
      }
    });
  }

  app.ticker.add(() => {
    debugUI.updateField("FPS", Math.round(app.ticker.FPS));
  });

  window.addEventListener("keydown", (ev: KeyboardEvent) => {
    if (ev.key == "`") debugUI.setVisible(!debugUI.isVisible());
  });

  // const response = await fetch("assets/test..tmj");
  // const mapData: TiledMap = await response.json();

  // let worldMap = await loadFromWorldMap(app, new WorldMap(mapData));
  // loadedWorldMap = worldMap;

  connectToGame()
    .then((net: GameNetwork) => {
      initGame(app, net);
    })
    .catch((error) => {
      console.error("Failed to connect to the game server:", error);
      debugUI.updateField("Room", "ERROR! " + error);
    });
})();
