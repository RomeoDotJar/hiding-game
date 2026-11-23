import {
  GAME_VERSION,
  TILEMAP_UPSCALE,
  USE_LOCALHOST,
} from "./shared/constants.js";
import {
  Application,
  Assets,
  Container,
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
import { Callbacks, Room } from "@colyseus/sdk";
import { PROXY_URL } from "./shared/constants.js";
import { MyRoomState, Player, WorldInfo } from "./shared/schema/MyRoomState.js";
import { TiledMap } from "./shared/world/TiledMap.js";
import { WorldMap } from "./shared/world/WorldMap.js";
import { generateGameBoard } from "./shared/world/generateTest.js";
import { loadMapData } from "./shared/world/load.js";

const debugUI = new DebugUI();

async function updateUptime() {
  if (USE_LOCALHOST) return;
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

let lastKnownWorldId = "";
let worldMap: WorldMap;

let cameraContainer: Container = new Container();
cameraContainer.sortableChildren = true;

let playerContainer: Container = new Container();
playerContainer.sortableChildren = true;
let debugContainer: Container = new Container();

function initGame(app: Application, net: GameNetwork) {
  const { room, predict, input } = net;

  let worldId = room.state.players.get(room.sessionId)?.worldId;
  let worldInfo = room.state.worlds.get(worldId!);
  loadMapData(worldInfo!).then((newMap) => {
    console.log(worldId,"loaded");
    worldMap = newMap!;
    loadFromWorldMap(app, worldMap);
  });

  console.log("Successfully connected to the game room!", room);
  debugUI.updateField("Room", room.roomId);
  debugUI.updateField("PlayerID", room.sessionId);

  interface RemotePlayerState {
    renderedX: number;
    renderedY: number;
    predictedVelX: number;
    predictedVelY: number;
    lastServerX: number;
    lastServerY: number;
    lastUpdateTime: number;

    sprite: Graphics;
    debugSprite: Graphics;
  }
  const remotePlayers = new Map<string, RemotePlayerState>();
  let selfPlayer: Graphics;
  let selfPlayerDebug: Graphics;

  const callbacks = Callbacks.get(room);

  const updatePlayerList = () => {
    const playerIds = Array.from(room.state.players.keys());
    const shortIds = playerIds.map((id: string) => id.substring(0, 4));

    const displayString = `${playerIds.length} [${shortIds.join(", ")}]`;

    debugUI.updateField("Players", displayString);
  };

  // 4. Call it whenever a player joins or leaves
  callbacks.onAdd("players", () => updatePlayerList());
  callbacks.onRemove("players", () => updatePlayerList());

  callbacks.onAdd("players", (player: Player, sessionId: string) => {
    const g = new Graphics();
    const debug_g = new Graphics();
    const isMe = sessionId === room.sessionId;

    const color = isMe ? 0x00ff00 : 0xff0000;

    const style = new TextStyle({
      fontFamily: "Consolas,Arial",
      fontSize: 12,
      fill: 0xffffff,
      stroke: { color: 0x000000, width: 2 },
    });

    const label = new Text({ text: sessionId.substring(0, 4), style });
    label.resolution = 2;

    label.anchor.set(0.5, 1);
    label.y = -12;

    g.addChild(label);

    g.rect(-10, -10, 20, 20).fill(color);
    //app.stage.addChild(g);

    debug_g.rect(-7.5, -7.5, 15, 15).fill(0xF1F111, 0.5);
    debug_g.zIndex -= 100;
    //app.stage.addChild(debug_g);

    if (isMe) {
      g.zIndex += 1000;
      selfPlayer = g;
      selfPlayerDebug = debug_g;

      lastKnownWorldId = player.worldId;

      // Hey, it's me!
      room.onMessage("moveToWorld", ({ worldInfo, worldId }) => {
        console.log(worldInfo, worldId);

        if (worldId !== lastKnownWorldId) {
          lastKnownWorldId = worldId;

          loadFromWorldInfo(app, worldInfo).then((world) => {
            if (world) {
              worldMap = world;
            } 
          });
        }
      });

    } else {
      remotePlayers.set(sessionId, {
        renderedX: player.x,
        renderedY: player.y,
        predictedVelX: 0,
        predictedVelY: 0,
        lastServerX: player.x,
        lastServerY: player.y,
        lastUpdateTime: performance.now(),
        sprite: g,
        debugSprite: debug_g,
      });
    }
    playerContainer.addChild(g);
    debugContainer.addChild(debug_g);
  });
  callbacks.onRemove("players", (_player: Player, sessionId: string) => {
    const state = remotePlayers.get(sessionId);
    if (state) {
      state.sprite.destroy();
      state.debugSprite.destroy();
      remotePlayers.delete(sessionId);
    }
  });

  // Listen to the phase changing
  callbacks.listen("phase", (newPhase: string) => {
    console.log("Phase changed to:", newPhase);
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

  app.ticker.add((ticker:Ticker) => {
    const now = performance.now();
    const steps = predict.tick(now);
    
    const deltaTime = Math.min(.1,ticker.deltaMS/1000);

    // INPUT HANDLING
    for (let i = 0; i < steps; i++) {
      input.data.moveX = getMoveX(selfPlayer.x,cameraContainer.x);
      input.data.moveY = getMoveY(selfPlayer.y,cameraContainer.y);
      input.data.interact = isInteractKeyPressed();
      input.send();
    }

    // PLAYER RENDERING
    const myPing = room.clock.rtt();
    for (const [sessionId, player] of room.state.players) {
      const storedRemotePlayer = remotePlayers.get(sessionId);
      if (storedRemotePlayer && player.worldId == worldId) {
        //const server_dt = (now - storedRemotePlayer.lastUpdateTime) / 1000;

        let deltaX = player.vx; //(player.x - storedRemotePlayer.lastServerX) / server_dt;
        let deltaY = player.vy; //(player.y - storedRemotePlayer.lastServerY) / server_dt;

        if (worldMap) {
          if (worldMap.checkCircleCollision(storedRemotePlayer.renderedX+deltaX*deltaTime, player.y, 2)) {
            deltaX = 0;
          }
          if (worldMap.checkCircleCollision(player.x, storedRemotePlayer.renderedY+deltaY*deltaTime, 2)) {
            deltaY = 0;
          }
        }

        // You can use a simple average like (predicted + actual) / 2,
        // or a frame-rate independent exponential smoothing for better feel.
        const velSmoothFactor = 1.25;
        // Frame-rate independent lerp towards the extrapolated target
        let renderSmoothFactor = .25;

        let predictionDeltaX = deltaX - storedRemotePlayer.predictedVelX
        if (predictionDeltaX * storedRemotePlayer.predictedVelX < 0) {
          predictionDeltaX *= Math.max(1, .1 / Math.max(.01,deltaTime));
        }
        storedRemotePlayer.predictedVelX +=
          predictionDeltaX * velSmoothFactor * deltaTime;
        
        let predictionDeltaY = deltaY - storedRemotePlayer.predictedVelY;
        if (predictionDeltaY * storedRemotePlayer.predictedVelY < 0) {
          predictionDeltaY *= Math.max(1, .1 / Math.max(.01,deltaTime));
        }
        storedRemotePlayer.predictedVelY +=
          predictionDeltaY * velSmoothFactor * deltaTime;

        // If the player is practically stopped, snap velocity to 0 to prevent drifting
        if (
          Math.abs(storedRemotePlayer.predictedVelX) < 1 &&
          Math.abs(deltaX) < 1
        )
          storedRemotePlayer.predictedVelX = 0;
        if (
          Math.abs(storedRemotePlayer.predictedVelY) < 1 &&
          Math.abs(deltaY) < 1
        )
          storedRemotePlayer.predictedVelY = 0;

        storedRemotePlayer.lastServerX = player.x;
        storedRemotePlayer.lastServerY = player.y;
        storedRemotePlayer.lastUpdateTime = now;

        // ==========================================
        // B. Predict the Future Position
        // ==========================================
        // The remote player's total delay includes THEIR upstream ping and YOUR downstream ping
        const remotePlayerUpstreamLatency = player.ping || 50; // Fallback to 50ms if rtt isn't set
        let totalPerceivedLatencySeconds =
          (remotePlayerUpstreamLatency + myPing) / 1000 / 2;
        totalPerceivedLatencySeconds = Math.min(totalPerceivedLatencySeconds, 1);

        // Calculate where they should be RIGHT NOW (extrapolation)
        const targetX =
          player.x +
          storedRemotePlayer.predictedVelX * totalPerceivedLatencySeconds;
        const targetY =
          player.y +
          storedRemotePlayer.predictedVelY * totalPerceivedLatencySeconds;

        // ==========================================
        // C. Smoothly Render
        // ==========================================
        
        let renderDeltaX = targetX - storedRemotePlayer.renderedX;
        let renderDeltaY = targetY - storedRemotePlayer.renderedY;
        //let renderDeltaDist = Math.sqrt(renderDeltaX*renderDeltaX + renderDeltaY*renderDeltaY);

        let newRenderedX =
          storedRemotePlayer.renderedX + renderDeltaX * renderSmoothFactor;
        let newRenderedY =
          storedRemotePlayer.renderedY + renderDeltaY * renderSmoothFactor;
        
        storedRemotePlayer.renderedX = newRenderedX;
        storedRemotePlayer.renderedY = newRenderedY;

        // Apply to PixiJS
        const g = storedRemotePlayer.sprite;
        g.x = storedRemotePlayer.renderedX * TILEMAP_UPSCALE;
        g.y = storedRemotePlayer.renderedY * TILEMAP_UPSCALE;
        const debug_g = storedRemotePlayer.debugSprite;
        debug_g.x = player.x * TILEMAP_UPSCALE;
        debug_g.y = player.y * TILEMAP_UPSCALE;

      } else if (sessionId === room.sessionId && selfPlayer) {
        selfPlayer.x = predict.value(player, "x") * TILEMAP_UPSCALE;
        selfPlayer.y = predict.value(player, "y") * TILEMAP_UPSCALE;

        selfPlayerDebug.x = (player.x + player.vx*player.ping/4000) * TILEMAP_UPSCALE;
        selfPlayerDebug.y = (player.y + player.vy*player.ping/4000) * TILEMAP_UPSCALE;

        debugUI.updateField('Position',Math.round(selfPlayer.x/10)*10+" "+Math.round(selfPlayer.y/10)*10);
        debugUI.updateField('Velocity',Math.round(predict.value(player,"vx")*10)/10+" "+Math.round(predict.value(player,"vy")*10)/10);
        debugUI.updateField('ServerPos',Math.round(selfPlayerDebug.x/10)*10+" "+Math.round(selfPlayerDebug.y/10)*10);
      }
    }

    // CAMERA HANDLING
    cameraContainer.x = window.innerWidth / 2 - selfPlayer.x;
    cameraContainer.y = window.innerHeight / 2 - selfPlayer.y;

    // MOUSE RAY
    if (worldMap === undefined || mouseX === undefined || mouseY === undefined)
      return;

    let worldMouseX = mouseX - cameraContainer.x;
    let worldMouseY = mouseY - cameraContainer.y;

    let ray = worldMap.raycast(
      selfPlayer.x / TILEMAP_UPSCALE,
      selfPlayer.y / TILEMAP_UPSCALE,
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
      .moveTo(selfPlayer.x, selfPlayer.y)
      .lineTo(ray.x, ray.y)
      .stroke({ width: 2, color: 0x00ff00 });
  });
}

async function renderMapData(worldMap: WorldMap, cameraContainer: Container) {
  let mapData = worldMap.mapData;

  console.log(mapData);

  const tilesetInfo = mapData.tilesets[0];
  const baseTexture = await Assets.load(
    `assets/${tilesetInfo.source.split(".")[0]}.png`,
  );

  const renderScale = TILEMAP_UPSCALE;

  const tileTextures: Record<number, Texture> = {};
  const cols = Math.floor(baseTexture.width / mapData.tilewidth);
  const rows = Math.floor(baseTexture.height / mapData.tileheight);

  console.log('Loading hub map 1/3');

  let gid = tilesetInfo.firstgid || 1;
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const frame = new Rectangle(
        col * mapData.tilewidth,
        row * mapData.tileheight,
        mapData.tilewidth,
        mapData.tileheight,
      );
      tileTextures[gid] = new Texture({ source: baseTexture.source, frame });
      gid++;
    }
  }

  for (const layer of mapData.layers) {
    if (layer.type !== "tilelayer" || !layer.visible || !layer.data) continue;
    //console.log(layer);

    const layerContainer = new Container();
    layerContainer.alpha = layer.opacity ?? 1;

    for (let i = 0; i < layer.data.length; i++) {
      const rawGid = layer.data[i];
      if (rawGid === 0) continue;

      // Strip Tiled's bitmask flags (horizontal/vertical/diagonal flips)
      const cleanGid = rawGid & ~(FLIP_D | FLIP_H | FLIP_V);
      const texture = tileTextures[cleanGid];

      if (texture) {
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
        layerContainer.addChild(sprite);
      }
    }

    if (
      layer.properties?.find((prop) => prop.name == "Background")?.value !==
      true
    ) {
      try {
        cameraContainer.getChildIndex(playerContainer);
      } catch {
        cameraContainer.addChild(debugContainer);
        cameraContainer.addChild(playerContainer);

        console.log("Player Container level");
      }
    }

    // Optimize static layers by caching them as a single texture
    layerContainer.cacheAsTexture(true);
    cameraContainer.addChild(layerContainer);
  }
}

// TILEMAP INIT
async function loadFromWorldInfo(app: Application, worldInfo: WorldInfo) {
  let worldMap = await loadMapData(worldInfo);
  if (!worldMap)
    return;

  return loadFromWorldMap(app, worldMap);
}

async function loadFromWorldMap(app: Application, hubWorld: WorldMap) {
  let mapData = hubWorld.mapData;

  console.log("Map dimensions:", mapData.width, "x", mapData.height);
  console.log("Map data:", mapData);

  cameraContainer.removeChildren();
  await renderMapData(hubWorld, cameraContainer);

  console.log('Loading hub map 2/3');

  // Add the rendered map to your PixiJS stage (at index 0 so it stays behind entities)
  app.stage.addChild(cameraContainer);

  // Find the spawn area object
  const objectsLayer = mapData.layers.find((l) => l.name === "Objs");
  const spawnArea = objectsLayer?.objects?.find(
    (o) => o.type === "SpawnArea",
  );

  console.log("Spawn Area found at:", spawnArea?.x, spawnArea?.y);

  return hubWorld;
}

TextureStyle.defaultOptions.scaleMode = "nearest";

const FLIP_H = 0x80000000;
const FLIP_V = 0x40000000;
const FLIP_D = 0x20000000;

(async () => {
  const app = new Application();

  await app.init({ background: "#1099bb", resizeTo: window });

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
        console.log(`FPS capped to ${newCap}`);
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
