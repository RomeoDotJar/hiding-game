import {
  Callbacks,
  Client,
  InputHandle,
  Predict,
  Room,
  StepContext,
} from "@colyseus/sdk";
import { MoveInput } from "./shared/input/MoveInput.js";
import { MyRoomState, Player, WorldInfo } from "./shared/schema/MyRoomState.js";
import { applyInput } from "./shared/input/applyInput.js";
import { LOCAL_URL, PROXY_URL, USE_LOCALHOST } from "./shared/constants.js";
import { WorldMap } from "./shared/world/WorldMap.js";
import { loadMapData } from "./shared/world/load.js";
//import { getMoveX, getMoveY, isInteractKeyPressed } from './input.js';

const useLocalHost = USE_LOCALHOST;
//const SERVER_URL =
//  import.meta.env.DEV && useLocalHost
//    ? "ws://localhost:2567"
//    : "wss://"+"6d1587ed12e4.pr.edgegap.net:31889";

async function getServerUrl(): Promise<string> {
  if (useLocalHost) return LOCAL_URL;

  const response = await fetch(PROXY_URL + "/get-server");
  const data = await response.json();

  if (data.url) {
    return data.url;
  } else {
    console.log("Server is unavailable yet, please wait...");
    await new Promise((resolve) => setTimeout(resolve, 5000));
    return getServerUrl();
  }
}

export interface GameNetwork {
  room: Room<MyRoomState>;
  predict: Predict<MyRoomState>;
  input: InputHandle<MoveInput>;
}

const PREDICTION_DELAY = 1;
const SMOOTHING = 2;

let predict: Predict;
function initPredict(room: Room, worldMap?: WorldMap): GameNetwork {
  if (!predict) {
      predict = Predict.get(room, {
      mode: "lerp",
      delay: PREDICTION_DELAY,
      snap: 100,
    });
  }

  // Built-in approach. Replaced with a custom one
  // predict.attachAll("players", {
  //   mode: "extrapolate",
  //   fields: ["x", "y", "isInteracting"],
  //   step: (ctx: StepContext, playerState: unknown, cmd: unknown) =>
  //     applyInput(
  //       playerState as unknown as PlayerEntity,
  //       cmd as MoveInput,
  //       ctx.dt,
  //     ),
  //   smoothMs: SMOOTHING,
  //   delay: PREDICTION_DELAY,
  //   snap: 0
  // });

  const self = room.state.players.get(room.sessionId);
  const input = room.input({ type: MoveInput });
  
  console.log("Moved to world",self.worldId);

  room.onMessage("moveToWorld", ({ worldInfo, worldId }) => {
    console.log("moveToWorld",worldInfo);

    loadMapData(worldInfo).then((loadedWorldMap?: WorldMap) => {
      worldMap = loadedWorldMap;
      console.log("Moved to world",worldId);
    });
  });

  predict.reconciler(self, {
    input,
    step: (ctx: StepContext, playerState: unknown, cmd: unknown) =>
      applyInput(
        playerState as unknown as Player,
        cmd as MoveInput,
        ctx.dt,
        () => {
          return worldMap;
        },
        2
      ),
    smoothMs: SMOOTHING,
    snap: 150,
  });

  return { room, predict, input };
}

export async function connectToGame(worldMap?: WorldMap): Promise<GameNetwork> {
  const serverUrl = await getServerUrl();
  console.log("Connecting to:", serverUrl);
  const client = new Client(serverUrl);
  const savedToken = sessionStorage.getItem("reconnection_token");
  let room: Room;

  // Handle Connection / Reconnection
  if (savedToken) {
    try {
      console.log("Attempting to reconnect...");
      room = await client.reconnect(savedToken);
      console.log("Successfully reconnected to room:", room.roomId);
    } catch (e) {
      console.warn("Reconnection failed, joining a new room...", e);
      sessionStorage.removeItem("reconnection_token");
      room = await client.joinOrCreate("my_room");
    }
  } else {
    room = await client.joinOrCreate("my_room");
    console.log("Joined room:", room.roomId);
  }

  sessionStorage.setItem("reconnection_token", room.reconnectionToken);

  room.onMessage("ping_request", (message: { timestamp: number }) => {
    room.send("pong_response", { timestamp: message.timestamp });
  });

  return new Promise((resolve) => {
    // Either resolve instantly or wait for the current client to be added
    if (
      room.state.players !== undefined &&
      room.state.players.has(room.sessionId)
    ) {

      let worldId = room.state.players.get(room.sessionId)?.worldId;
      let worldInfo = room.state.worlds.get(worldId!);
      loadMapData(worldInfo!).then((newMap) => {
        console.log(newMap);
        worldMap = newMap!;
        resolve(initPredict(room, worldMap));
      });
      return;
    }

    const callbacks = Callbacks.get(room);
    callbacks.onAdd("players", () => {
      if (room.state.players.has(room.sessionId)) {

        let worldId = room.state.players.get(room.sessionId)?.worldId;
        let worldInfo = room.state.worlds.get(worldId!);
        loadMapData(worldInfo!).then((newMap) => {
          console.log(newMap);
          worldMap = newMap!;
          resolve(initPredict(room, worldMap));
        });
      }
    });
  });
}
