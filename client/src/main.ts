import { Application, Assets, Graphics, Sprite, Text, TextStyle } from "pixi.js";
import { connectToGame, GameNetwork } from './network';
import { DebugUI } from "./ui/DebugUI.js";
import { getMoveX, getMoveY, isInteractKeyPressed } from "./input.js";
import { Callbacks } from "@colyseus/sdk";

const debugUI = new DebugUI();

function initGame(app: Application, net: GameNetwork) {
  const { room, predict, input } = net;

  console.log("Successfully connected to the game room!", room);
  debugUI.updateField('Room', room.roomId);
  debugUI.updateField('PlayerID', room.sessionId);

  const playerGraphics = new Map<string, Graphics>();

  const callbacks = Callbacks.get(room);

  const updatePlayerList = () => {
    const playerIds = Array.from(room.state.players.keys());
    const shortIds = playerIds.map(id => id.substring(0, 4));

    const displayString = `${playerIds.length} [${shortIds.join(', ')}]`;

    debugUI.updateField('Players', displayString);
  };

  // 4. Call it whenever a player joins or leaves
  callbacks.onAdd("players", () => updatePlayerList());
  callbacks.onRemove("players", () => updatePlayerList());

  callbacks.onAdd("players", (player: any, sessionId: string) => {
    const g = new Graphics();
    const isMe = sessionId === room.sessionId;

    const color = isMe ? 0x00FF00 : 0xFF0000;

    const style = new TextStyle({
      fontFamily: 'Consolas,Arial',
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

    if (isMe) {
      g.zIndex+=1000;
    }

    playerGraphics.set(sessionId, g);
  });

  setInterval(() => {
    room.ping((ms: number) => {
      debugUI.updateField('Ping', `${ms}ms`);
    });
  }, 1000);

  app.ticker.add(() => {
    const now = performance.now();
    const steps = predict.tick(now);

    for (let i = 0; i < steps; i++) {
      input.data.moveX = getMoveX();
      input.data.moveY = getMoveY();
      input.data.interact = isInteractKeyPressed();
      input.send();
    }

    for (const [sessionId, player] of room.state.players) {
      const g = playerGraphics.get(sessionId);
      if (g) {
        g.x = predict.value(player, "x");
        g.y = predict.value(player, "y");
      }
    }
  });
}

(async () => {
  const app = new Application();

  await app.init({ background: "#1099bb", resizeTo: window });

  document.getElementById("pixi-container")!.appendChild(app.canvas);
  debugUI.addField('FPS', '0');
  debugUI.addField('Ping', '0');
  debugUI.addField('Room', 'Connecting...');
  debugUI.addField('PlayerID', '...');
  debugUI.addField('Players', '...');

  app.ticker.add((time) => {
    debugUI.updateField('FPS', Math.round(app.ticker.FPS));
  });

  connectToGame().then((net: GameNetwork) => {
    initGame(app,net);
  }).catch((error) => {
    console.error("Failed to connect to the game server:", error);
    debugUI.updateField('Room', 'ERROR! ' + error);
  });

})();
