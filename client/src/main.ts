import { GAME_VERSION } from "./shared/constants.js";
import { Application, Graphics, Text, TextStyle } from "pixi.js";
import { connectToGame, GameNetwork } from "./network";
import { DebugUI } from "./ui/DebugUI.js";
import { getMoveX, getMoveY, isInteractKeyPressed } from "./input.js";
import { Callbacks } from "@colyseus/sdk";
import { PROXY_URL } from "./shared/constants.js";
import { Player } from "./shared/schema/MyRoomState.js";

const debugUI = new DebugUI();

async function updateUptime() {
  try {
    const response = await fetch(`${PROXY_URL}/get-uptime`);
    const data = await response.json();
    
    if (data.remainingSeconds !== undefined) {
      // Format as MM:SS
      const minutes = Math.floor(data.remainingSeconds / 60);
      const seconds = data.remainingSeconds % 60;
      const timeString = `${minutes}:${seconds.toString().padStart(2, '0')}`;
      debugUI.updateField("Uptime", timeString);
    }
  } catch (err) {
    debugUI.updateField("Uptime", "Error");
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
  var selfPlayer: Graphics;

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
    app.stage.addChild(g);

    debug_g.rect(-5,-5,10,10).fill(0x111111,.5);
    debug_g.zIndex -= 100;
    app.stage.addChild(debug_g);

    if (isMe) {
      g.zIndex += 1000;
      selfPlayer = g;
    }
    else {
      remotePlayers.set(sessionId, {
        renderedX: player.x,
        renderedY: player.y,
        predictedVelX: 0,
        predictedVelY: 0,
        lastServerX: player.x,
        lastServerY: player.y,
        lastUpdateTime: performance.now(),
        sprite: g,
        debugSprite: debug_g
      });
    }
  });
  callbacks.onRemove("players", (_player: Player, sessionId: string) => {
    const state = remotePlayers.get(sessionId);
    if (state) {
      state.sprite.destroy();
      remotePlayers.delete(sessionId);
    }
  });

  setInterval(() => {
    room.ping((ms: number) => {
      debugUI.updateField("Ping", `${ms}ms`);
    });
  }, 1000);

  setInterval(updateUptime, 15000);
  updateUptime()

  app.ticker.add(() => {
    const now = performance.now();
    const steps = predict.tick(now);

    for (let i = 0; i < steps; i++) {
      input.data.moveX = getMoveX();
      input.data.moveY = getMoveY();
      input.data.interact = isInteractKeyPressed();
      input.send();
    }

    const myPing = room.clock.rtt();

    for (const [sessionId, player] of room.state.players) {
      const storedRemotePlayer = remotePlayers.get(sessionId);
      if (storedRemotePlayer) {
          //const server_dt = (now - storedRemotePlayer.lastUpdateTime) / 1000;

          const deltaX = player.vx;//(player.x - storedRemotePlayer.lastServerX) / server_dt;
          const deltaY = player.vy;//(player.y - storedRemotePlayer.lastServerY) / server_dt;

          // You can use a simple average like (predicted + actual) / 2, 
          // or a frame-rate independent exponential smoothing for better feel.
          const velSmoothFactor = .125;
          storedRemotePlayer.predictedVelX += (deltaX - storedRemotePlayer.predictedVelX) * velSmoothFactor;
          storedRemotePlayer.predictedVelY += (deltaY - storedRemotePlayer.predictedVelY) * velSmoothFactor;
          
          // If the player is practically stopped, snap velocity to 0 to prevent drifting
          if (Math.abs(storedRemotePlayer.predictedVelX) < 5 && Math.abs(deltaX) < 5) storedRemotePlayer.predictedVelX = 0;
          if (Math.abs(storedRemotePlayer.predictedVelY) < 5 && Math.abs(deltaY) < 5) storedRemotePlayer.predictedVelY = 0;

          storedRemotePlayer.lastServerX = player.x;
          storedRemotePlayer.lastServerY = player.y;
          storedRemotePlayer.lastUpdateTime = now;

          // ==========================================
          // B. Predict the Future Position
          // ==========================================
          // The remote player's total delay includes THEIR upstream ping and YOUR downstream ping
          const remotePlayerUpstreamLatency = player.ping || 50; // Fallback to 50ms if rtt isn't set
          const totalPerceivedLatencySeconds = (remotePlayerUpstreamLatency + myPing) / 1000 / 2;

          // Calculate where they should be RIGHT NOW (extrapolation)
          const targetX = player.x + (storedRemotePlayer.predictedVelX * totalPerceivedLatencySeconds);
          const targetY = player.y + (storedRemotePlayer.predictedVelY * totalPerceivedLatencySeconds);

          // ==========================================
          // C. Smoothly Render
          // ==========================================
          // Frame-rate independent lerp towards the extrapolated target
          const renderSmoothFactor = .25;
          
          storedRemotePlayer.renderedX += (targetX - storedRemotePlayer.renderedX) * renderSmoothFactor;
          storedRemotePlayer.renderedY += (targetY - storedRemotePlayer.renderedY) * renderSmoothFactor;

          // Apply to PixiJS
          let g = storedRemotePlayer.sprite;
          g.x = storedRemotePlayer.renderedX;
          g.y = storedRemotePlayer.renderedY;
          let debug_g = storedRemotePlayer.debugSprite;
          debug_g.x = targetX;
          debug_g.y = targetY;
      }
      else if (sessionId===room.sessionId && selfPlayer) {
        selfPlayer.x = predict.value(player, "x");
        selfPlayer.y = predict.value(player, "y");
      }
    }
  });
}

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

  connectToGame()
    .then((net: GameNetwork) => {
      initGame(app, net);
    })
    .catch((error) => {
      console.error("Failed to connect to the game server:", error);
      debugUI.updateField("Room", "ERROR! " + error);
    });
})();
