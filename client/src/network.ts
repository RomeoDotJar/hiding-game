import {
  Callbacks,
  Client,
  InputHandle,
  Predict,
  Room,
  StepContext,
} from "@colyseus/sdk";
import { MoveInput } from "./shared/input/MoveInput.js";
import { MyRoomState, Player } from "./shared/schema/MyRoomState.js";
import { applyInput } from "./shared/input/applyInput.js";
import { LOCAL_URL, PROXY_URL, USE_LOCALHOST } from "./shared/constants.js";
import { WorldMap } from "./shared/world/WorldMap.js";
import { LoadedMapData, loadMapData } from "./shared/world/utils/load.js";
//import { getMoveX, getMoveY, isInteractKeyPressed } from './input.js';

const useLocalHost = USE_LOCALHOST && import.meta.env.DEV;
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

let worldMap: WorldMap; // Currently running WorldMap

function initWorldMap(loadedWorldMap?: WorldMap) {
  worldMap = loadedWorldMap || worldMap;

  return worldMap;
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
  if (predict) {
    //predict.dispose();
  } else {
    predict = Predict.get(room, {
      mode: "lerp",
      delay: PREDICTION_DELAY,
      snap: 100,
    });
  }

  const self = room.state.players.get(room.sessionId);
  const input = room.input({ type: MoveInput });

  room.onMessage("moveToWorld", ({ worldInfo }) => {
    loadMapData(worldInfo).then((loadedMapData: LoadedMapData) => {
      worldMap = initWorldMap(loadedMapData.worldMap);
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
        2,
      ),
    smoothMs: SMOOTHING,
    snap: 150,
  });

  return { room, predict, input };
}

export async function connectToGame(worldMap?: WorldMap): Promise<GameNetwork> {
  const serverUrl = await getServerUrl();
  const client = new Client(serverUrl);
  const savedToken = sessionStorage.getItem("reconnection_token");
  let room: Room;

  // Handle Connection / Reconnection
  if (savedToken) {
    try {
      room = await client.reconnect(savedToken);
    } catch (e) {
      console.warn("Reconnection failed, joining a new room...", e);
      sessionStorage.removeItem("reconnection_token");
      room = await client.joinOrCreate("my_room");
    }
  } else {
    room = await client.joinOrCreate("my_room");
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
      const worldId = room.state.players.get(room.sessionId)?.worldId;
      const worldInfo = room.state.worlds.get(worldId!);

      loadMapData(worldInfo!).then((loadedMapData: LoadedMapData) => {
        worldMap = initWorldMap(loadedMapData.worldMap);
        resolve(initPredict(room, worldMap));
      });
      return;
    }

    const callbacks = Callbacks.get(room);
    callbacks.onAdd("players", (_, sessionId) => {
      if (sessionId === room.sessionId) {
        const worldId = room.state.players.get(room.sessionId)?.worldId;
        const worldInfo = room.state.worlds.get(worldId!);

        loadMapData(worldInfo!).then((loadedMapData: LoadedMapData) => {
          worldMap = initWorldMap(loadedMapData.worldMap);
          resolve(initPredict(room, worldMap));
        });
      }
    });
  });
}
