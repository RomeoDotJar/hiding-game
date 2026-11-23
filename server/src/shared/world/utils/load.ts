import { PRNG } from "../../PRNG.js";
import { WorldInfo } from "../../schema/MyRoomState.js";
import { TiledMap } from "../TiledMap.js";
import { WorldMap } from "../WorldMap.js";
import { generateGameBoard } from "../generateTest.js";
import { autoTileWalls } from "../generation/AutoTiler.js";
import { ConnectivityGenerator } from "../generation/ConnectivityGenerator.js";
import { GameplayPlacementGenerator } from "../generation/GameplayPlacementGenerator.js";
import { RoomGenerator } from "../generation/RoomGenerator.js";
import { TilemapAssembler } from "../generation/TilemapAssembler.js";
import { createMapGenerationConfig } from "../generation/config/DefaultConfig.js";
import { GeneratedGameplayObject } from "../generation/types/GameplayTypes.js";
import { parseTiledObjects } from "./parseTiledObjects.js";

export interface LoadedMapData {
  worldMap?: WorldMap;
  gameplayObjects?: GeneratedGameplayObject[];
}

export async function loadMapData(worldInfo: WorldInfo): Promise<LoadedMapData> {
  if (worldInfo.type === "Hub") {
    const response = await fetch(worldInfo.path ?? "assets/test..tmj");
    const mapData: TiledMap = await response.json();

    const hubWorld = new WorldMap(mapData);
    const gameplayObjects = parseTiledObjects(mapData);

    return { worldMap: hubWorld, gameplayObjects };

  } else if (worldInfo.type === "GameBoard") {
    const roomRng = new PRNG(worldInfo.seed);

    const config = createMapGenerationConfig();
    const rooms = new RoomGenerator(config, roomRng).generate();
    const connectivity = new ConnectivityGenerator(config, roomRng).generate(
      rooms,
    );
    //const graph = new RoomGraph(rooms, connectivity.connections);

    const placement = new GameplayPlacementGenerator(config, roomRng).generate(
      rooms,
      connectivity.connections,
    );

    const assembler = new TilemapAssembler(config, roomRng);

    const tiledMap = assembler.assemble({
      rooms: placement.rooms,
      connectivity,
      gameplay: placement,
    });

    const finalMap = autoTileWalls(tiledMap);

    const gbWorld = new WorldMap(finalMap);
    return { worldMap: gbWorld, gameplayObjects: placement.objects };

  } else if (worldInfo.type === "GameBoardDeprecated") {
    const mapData: TiledMap = generateGameBoard(worldInfo.seed);

    const gbWorld = new WorldMap(mapData);
    const gameplayObjects = parseTiledObjects(mapData);

    return { worldMap: gbWorld, gameplayObjects };
  }
  return {};
}
