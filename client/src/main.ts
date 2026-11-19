import { GAME_VERSION, TILEMAP_UPSCALE, USE_LOCALHOST } from "./shared/constants.js";
import { Application, Assets, Container, Graphics, Rectangle, Sprite, Text, TextStyle, Texture, TextureStyle } from "pixi.js";
import { connectToGame, GameNetwork } from "./network";
import { DebugUI } from "./ui/DebugUI.js";
import { getMoveX, getMoveY, isInteractKeyPressed } from "./input.js";
import { Callbacks } from "@colyseus/sdk";
import { PROXY_URL } from "./shared/constants.js";
import { Player } from "./shared/schema/MyRoomState.js";
    import { TiledMap } from './shared/world/TiledMap.js';
import { WorldMap } from "./shared/world/WorldMap.js";

const debugUI = new DebugUI();

async function updateUptime() {
  if (USE_LOCALHOST)
    return;
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

function initGame(app: Application, net: GameNetwork) {
  const { room, predict, input } = net;

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

  let playerContainer: Container = new Container();
  playerContainer.sortableChildren = true;
  let debugContainer: Container = new Container();

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

    debug_g.rect(-5, -5, 10, 10).fill(0x111111, 0.5);
    debug_g.zIndex -= 100;
    //app.stage.addChild(debug_g);

    if (isMe) {
      g.zIndex += 1000;
      selfPlayer = g;
      selfPlayerDebug = debug_g;
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

  setInterval(() => {
    room.ping((ms: number) => {
      debugUI.updateField("Ping", `${ms}ms`);
    });
  }, 1000);

  setInterval(updateUptime, 15000);
  updateUptime();

  let mouseX:number;
  let mouseY:number;
  let mouseRay = new Graphics();

  let hubWorld: WorldMap;

  document.addEventListener('mousemove', (ev:MouseEvent)=>{mouseX=ev.pageX;mouseY=ev.pageY;}, false);

  app.ticker.add(() => {
    const now = performance.now();
    const steps = predict.tick(now);

    for (let i = 0; i < steps; i++) {
      input.data.moveX = getMoveX(selfPlayer);
      input.data.moveY = getMoveY(selfPlayer);
      input.data.interact = isInteractKeyPressed();
      input.send();
    }

    const myPing = room.clock.rtt();

    for (const [sessionId, player] of room.state.players) {
      const storedRemotePlayer = remotePlayers.get(sessionId);
      if (storedRemotePlayer) {
        //const server_dt = (now - storedRemotePlayer.lastUpdateTime) / 1000;

        const deltaX = player.vx; //(player.x - storedRemotePlayer.lastServerX) / server_dt;
        const deltaY = player.vy; //(player.y - storedRemotePlayer.lastServerY) / server_dt;

        // You can use a simple average like (predicted + actual) / 2,
        // or a frame-rate independent exponential smoothing for better feel.
        const velSmoothFactor = 0.25;
        storedRemotePlayer.predictedVelX +=
          (deltaX - storedRemotePlayer.predictedVelX) * velSmoothFactor;
        storedRemotePlayer.predictedVelY +=
          (deltaY - storedRemotePlayer.predictedVelY) * velSmoothFactor;

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
        const totalPerceivedLatencySeconds =
          (remotePlayerUpstreamLatency + myPing) / 1000;

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
        // Frame-rate independent lerp towards the extrapolated target
        const renderSmoothFactor = 0.125;

        storedRemotePlayer.renderedX +=
          (targetX - storedRemotePlayer.renderedX) * renderSmoothFactor;
        storedRemotePlayer.renderedY +=
          (targetY - storedRemotePlayer.renderedY) * renderSmoothFactor;

        // Apply to PixiJS
        const g = storedRemotePlayer.sprite;
        g.x = storedRemotePlayer.renderedX * TILEMAP_UPSCALE;
        g.y = storedRemotePlayer.renderedY * TILEMAP_UPSCALE;
        const debug_g = storedRemotePlayer.debugSprite;
        debug_g.x = targetX * TILEMAP_UPSCALE;
        debug_g.y = targetY * TILEMAP_UPSCALE;
      } else if (sessionId === room.sessionId && selfPlayer) {
        selfPlayer.x = predict.value(player, "x") * TILEMAP_UPSCALE;
        selfPlayer.y = predict.value(player, "y") * TILEMAP_UPSCALE;
        
        selfPlayerDebug.x = player.x * TILEMAP_UPSCALE;
        selfPlayerDebug.y = player.y * TILEMAP_UPSCALE;
      }
    }

    // ==========================================
    // NEW: Local Collision Detection & Tagging
    // ==========================================
    const localPlayer = room.state.players.get(room.sessionId);
    if (localPlayer) {
      // 1. Get the local player's predicted (rendered) position
      const localX = predict.value(localPlayer, "x");
      const localY = predict.value(localPlayer, "y");

      let isCollidingRightNow = false;

      // 2. Check distance against all remote players
      for (const [_sessionId, state] of remotePlayers) {
        const dx = state.renderedX - localX;
        const dy = state.renderedY - localY;
        const distance = Math.sqrt(dx * dx + dy * dy);

        if (distance < 5) {
          isCollidingRightNow = true;
          break;
        }
      }

      if (isCollidingRightNow) {
        console.log("Local collision detected! Sending tag_attempt...");
        room.send("tag_attempt");
      }
    }
    
    if (hubWorld===undefined || mouseX===undefined || mouseY===undefined)
      return;
    
    let ray = hubWorld.raycast(selfPlayer.x/TILEMAP_UPSCALE,selfPlayer.y/TILEMAP_UPSCALE, mouseX/TILEMAP_UPSCALE,mouseY/TILEMAP_UPSCALE);

    if (ray===null) {
      ray = {x:mouseX,y:mouseY};
    }
    else {
      ray.x *= TILEMAP_UPSCALE;
      ray.y *= TILEMAP_UPSCALE;
    }

    mouseRay
      .clear()
      .moveTo(selfPlayer.x,selfPlayer.y)
      .lineTo(ray.x,ray.y)
      .stroke({ width: 2, color: 0x00ff00 });
  });

  app.stage.addChild(mouseRay);
  
  // TILEMAP INIT
  async function loadHubMap() {
    const response = await fetch('assets/test..tmj');
    const mapData: TiledMap = await response.json();
    
    hubWorld = new WorldMap(mapData);

    console.log("Map dimensions:", mapData.width, "x", mapData.height);
    console.log("Map data:", mapData);

    const tilesetInfo = mapData.tilesets[0];
    const baseTexture = await Assets.load(`assets/${tilesetInfo.source.split('.')[0]}.png`);

    const renderScale = TILEMAP_UPSCALE;

    const tileTextures: Record<number, Texture> = {};
    const cols = Math.floor(baseTexture.width / mapData.tilewidth);
    const rows = Math.floor(baseTexture.height / mapData.tileheight);

    let gid = tilesetInfo.firstgid || 1;
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const frame = new Rectangle(
          col * mapData.tilewidth,
          row * mapData.tileheight,
          mapData.tilewidth,
          mapData.tileheight
        );
        tileTextures[gid] = new Texture({ source: baseTexture.source, frame });
        gid++;
      }
    }

    const mapContainer = new Container();

    for (const layer of mapData.layers) {
      if (layer.type !== 'tilelayer' || !layer.visible || !layer.data) continue;
      console.log(layer);

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
          sprite.anchor = .5;
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

          sprite.x = (col+.5) * mapData.tilewidth * renderScale;
          sprite.y = (row+.5) * mapData.tileheight * renderScale;
          layerContainer.addChild(sprite);
        }
      }

      if (layer.properties?.find((prop)=>prop.name=='Background')?.value !== true) {
        try {
          mapContainer.getChildIndex(playerContainer);
        }
        catch(e) {
          mapContainer.addChild(debugContainer);
          mapContainer.addChild(playerContainer);

          console.log("Player Container level");
        }
      }

      // Optimize static layers by caching them as a single texture
      layerContainer.cacheAsTexture(true);
      mapContainer.addChild(layerContainer);
    }

    // Add the rendered map to your PixiJS stage (at index 0 so it stays behind entities)
    app.stage.addChildAt(mapContainer, 0);
    
    // Find the spawn area object
    const objectsLayer = mapData.layers.find(l => l.name === 'Objs');
    const spawnArea = objectsLayer?.objects?.find(o => o.type === 'SpawnArea');
    
    console.log("Spawn Area found at:", spawnArea?.x, spawnArea?.y);
  }
  loadHubMap();
}

TextureStyle.defaultOptions.scaleMode = 'nearest';

const FLIP_H = 0x80000000;
const FLIP_V = 0x40000000;
const FLIP_D = 0x20000000;

(async () => {
  const app = new Application();

  await app.init({ background: "#1099bb", resizeTo: window });

  document.getElementById("pixi-container")!.appendChild(app.canvas);
  debugUI.addField("Version", GAME_VERSION);
  debugUI.addField("FPS", "");
  debugUI.addField("Room", "Connecting...");
  debugUI.addField("Ping", "");
  debugUI.addField("Uptime", "");
  debugUI.addField("PlayerID", "");
  debugUI.addField("Players", "");

  app.ticker.add(() => {
    debugUI.updateField("FPS", Math.round(app.ticker.FPS));
  });

  window.addEventListener("keydown",(ev:KeyboardEvent) => {
    //console.log(ev.key);
    if (ev.key=='`')
      debugUI.setVisible(!debugUI.isVisible());
  });

  connectToGame()
    .then((net: GameNetwork) => {
      initGame(app, net);
    })
    .catch((error) => {
      console.error("Failed to connect to the game server:", error);
      debugUI.updateField("Room", "ERROR! " + error);
    });
})();
