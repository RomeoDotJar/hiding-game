import {
  Callbacks,
  Client,
  InputHandle,
  Predict,
  Room,
  StepContext,
} from "@colyseus/sdk";
import { MoveInput } from "./shared/input/MoveInput.js";
import { MyRoomState } from "./shared/schema/MyRoomState.js";
import { applyInput, type PlayerEntity } from "./shared/input/applyInput.js";
//import { getMoveX, getMoveY, isInteractKeyPressed } from './input.js';

const useLocalHost = false;
const PROXY_URL = "https://server-proxy.romeodotjar-hiding-game.workers.dev/get-server";
const LOCAL_URL = "ws://localhost:2567";
//const SERVER_URL =
//  import.meta.env.DEV && useLocalHost
//    ? "ws://localhost:2567"
//    : "wss://"+"6d1587ed12e4.pr.edgegap.net:31889";

async function getServerUrl(): Promise<string> {
  if (useLocalHost)
    return LOCAL_URL;

  const response = await fetch(PROXY_URL);
  const data = await response.json();

  if (data.url) {
    return data.url;
  }

  if (data.status === "deploying") {
    console.log("Server is deploying, please wait...");
    await new Promise(resolve => setTimeout(resolve, 5000));
    return getServerUrl();
  }

  throw new Error("Failed to obtain server URL");
}

export interface GameNetwork {
  room: Room<MyRoomState>;
  predict: Predict<MyRoomState>;
  input: InputHandle<MoveInput>;
}

const PREDICTION_DELAY = 20;
const SELF_SMOOTHING = 50;

function initPredict(room: Room): GameNetwork {
  const predict = Predict.get(room, { mode: "lerp", delay: PREDICTION_DELAY });
  predict.attachAll("players", {
    mode: "lerp",
    fields: ["x", "y", "isInteracting"],
  });

  const self = room.state.players.get(room.sessionId);
  const input = room.input({ type: MoveInput });

  predict.reconciler(self, {
    input,
    step: (ctx: StepContext, playerState: unknown, cmd: unknown) =>
      applyInput(
        playerState as unknown as PlayerEntity,
        cmd as MoveInput,
        ctx.dt,
      ),
    smoothMs: SELF_SMOOTHING,
  });

  return { room, predict, input };
}

export async function connectToGame(): Promise<GameNetwork> {
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

  return new Promise((resolve) => {
    // Either resolve instantly or wait for the current client to be added
    if (
      room.state.players !== undefined &&
      room.state.players.has(room.sessionId)
    ) {
      resolve(initPredict(room));
      return;
    }

    const callbacks = Callbacks.get(room);
    callbacks.onAdd("players", () => {
      if (room.state.players.has(room.sessionId)) {
        resolve(initPredict(room));
      }
    });
  });
}
