import { PRNG } from "../PRNG.js";
import { WorldInfo } from "../schema/MyRoomState.js";
import { TiledMap } from "./TiledMap.js";
import { WorldMap } from "./WorldMap.js";
import { generateGameBoard } from "./generateTest.js";
import { autoTileWalls } from "./generation/AutoTiler.js";
import { ConnectivityGenerator } from "./generation/ConnectivityGenerator.js";
import { GameplayPlacementGenerator } from "./generation/GameplayPlacementGenerator.js";
import { RoomGenerator } from "./generation/RoomGenerator.js";
import { TilemapAssembler } from "./generation/TilemapAssembler.js";
import { createMapGenerationConfig } from "./generation/config/DefaultConfig.js";
import { RoomGraph } from "./generation/utils/RoomGraph.js";

export async function loadMapData(worldInfo: WorldInfo) {
  console.log("loadMapData",worldInfo);
  
  if (worldInfo.type === 'Hub') {
    const response = await fetch(worldInfo.path ?? "assets/test..tmj");
    const mapData: TiledMap = await response.json();

    let hubWorld = new WorldMap(mapData);
    return hubWorld;
  }
  else if (worldInfo.type === 'GameBoard') {
    const roomRng = new PRNG(worldInfo.seed);

    const config = createMapGenerationConfig();
    const rooms = new RoomGenerator(
      config,
      roomRng,
    ).generate();
    const connectivity = new ConnectivityGenerator(
      config,
      roomRng,
    ).generate(rooms);
    const graph = new RoomGraph(
      rooms,
      connectivity.connections,
    );

    const placement = new GameplayPlacementGenerator(
      config,
      roomRng,
    ).generate(rooms, connectivity.connections);

    const assembler = new TilemapAssembler(config, roomRng);

    const tiledMap = assembler.assemble({
      rooms: placement.rooms,
      connectivity,
      gameplay: placement,
    });

    const finalMap = autoTileWalls(tiledMap);

    // console.log("ROOMS:");
    // console.dir(rooms, { depth: null });
    // console.log("CONNECTIVITY:");
    // console.dir(connectivity, { depth: null });
    // console.log("GRAPH:");
    // console.dir(graph, { depth: 3 });

    // console.log("GAMEPLAY_ROOMS:");
    // console.dir(gameplayRooms, { depth: null });
    // console.log("GAMEPLAY_OBJS:");
    // console.dir(gameplayObjects, { depth: null });

    // console.log("TILED_MAP:");
    // console.dir(tiledMap, { depth: null });


    // DEPRECATED GEN
    // let mapData: TiledMap = generateGameBoard(worldInfo.seed);

    let gbWorld = new WorldMap(finalMap);
    return gbWorld;
  }
  else if (worldInfo.type === 'GameBoardDeprecated') {
    let mapData: TiledMap = generateGameBoard(worldInfo.seed);

    let gbWorld = new WorldMap(mapData);
    return gbWorld;
  }
}