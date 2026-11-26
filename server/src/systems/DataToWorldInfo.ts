import { ChestState, DoorState, InteractableState, ClosetState, RitualState, WorldInfo } from "../shared/schema/MyRoomState.js";
import { GeneratedGameplayObject as GameplayObject } from "../shared/world/generation/types/GameplayTypes.js";

export function loadGameplayObjectsToWorldInfo(gameplayObjects: GameplayObject[], worldInfo: WorldInfo = new WorldInfo()): WorldInfo {
    // Spawn network states into the WorldInfo schema
    for (const obj of gameplayObjects || []) {
        if (obj.kind === "SpawnArea") continue; // Don't sync spawn zones

        let state: InteractableState;

        // Instantiate the correct subclass based on the object kind
        switch (obj.kind) {
            case "Door":
                const door = new DoorState();
                door.isOpen = obj.initialState === "OPEN";
                state = door;
                break;
            case "Chest":
                const chest = new ChestState();
                chest.isLooted = false;
                state = chest;
                break;
            case "Ritual":
                const ritual = new RitualState();
                ritual.chalkCount = 0;
                state = ritual;
                break;
            case "Closet": // The generator uses "Closet" for lockers
                const locker = new ClosetState();
                locker.isOccupied = false;
                state = locker;
                break;
            default:
                continue;
        }

        state.id = obj.id.toString();
        worldInfo.interactables.set(state.id, state);
    }

    return worldInfo;
}