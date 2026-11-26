import { PRNG } from "../../PRNG.js";
import { WorldInfo } from "../../schema/MyRoomState.js";
import { TiledMap } from "../TiledMap.js";
import { WorldMap } from "../WorldMap.js";
import { generateGameBoard } from "../generateTest.js";
import { ConnectivityGenerator } from "../generation/ConnectivityGenerator.js";
import { GameplayPlacementGenerator } from "../generation/GameplayPlacementGenerator.js";
import { TilemapAssembler } from "../generation/TilemapAssembler.js";
import { createMapGenerationConfig } from "../generation/config/DefaultConfig.js";
import { GeneratedGameplayObject } from "../generation/types/GameplayTypes.js";
import { GeneratedRoom } from "../generation/types/RoomTypes.js";
import { generateRoomsDynamicSize } from "../generation/utils/MapGenerationUtils.js";
import { parseTiledObjects } from "./parseTiledObjects.js";

export interface LoadedMapData {
  worldMap?: WorldMap;
  gameplayObjects?: GeneratedGameplayObject[];
  generatedRooms?: GeneratedRoom[];
}

export async function loadMapData(
  worldInfo: WorldInfo,
): Promise<LoadedMapData> {
  if (worldInfo.type === "Hub") {
    const response = await fetch(worldInfo.path ?? "assets/hub.tmj");
    const mapData: TiledMap = await response.json();

    const hubWorld = new WorldMap(mapData);
    const gameplayObjects = parseTiledObjects(mapData);

    return { worldMap: hubWorld, gameplayObjects };
  } else if (worldInfo.type === "GameBoard") {

    if (worldInfo.mapData && worldInfo.mapData.worldMap) {
      return worldInfo.mapData;
    }

    const roomRng = new PRNG(worldInfo.seed);
    const config = createMapGenerationConfig();
    const { rooms, dynamicConfig } = generateRoomsDynamicSize(config, worldInfo.seed);
    
    const connectivity = new ConnectivityGenerator(dynamicConfig, roomRng).generate(
      rooms,
    );
    const placement = new GameplayPlacementGenerator(dynamicConfig, roomRng).generate(
      rooms,
      connectivity.connections,
    );
    const assembler = new TilemapAssembler(dynamicConfig, roomRng);

    const tiledMap = assembler.assemble({
      rooms: placement.rooms,
      connectivity,
      gameplay: placement,
    });

    const gbWorld = new WorldMap(tiledMap);

    return { worldMap: gbWorld, gameplayObjects: placement.objects, generatedRooms: placement.rooms };
  } else if (worldInfo.type === "GameBoardDeprecated") {
    const mapData: TiledMap = generateGameBoard(worldInfo.seed);

    const gbWorld = new WorldMap(mapData);
    const gameplayObjects = parseTiledObjects(mapData);

    return { worldMap: gbWorld, gameplayObjects };
  }
  return {};
}
