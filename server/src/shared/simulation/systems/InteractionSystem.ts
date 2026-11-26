import { Entity, EntitySystem, Matcher } from "@esengine/ecs-framework";
import {
  TransformComponent,
  ColliderComponent,
  InteractableComponent,
  PlayerComponent,
} from "../components.js";

export class InteractionSystem extends EntitySystem {
  private interactables: Entity[] = [];

  constructor() {
    super(Matcher.all(TransformComponent, ColliderComponent, PlayerComponent));
  }

  // We'll pass in the interactables array so the system knows what to check against
  public setInteractables(entities: Entity[]) {
    this.interactables = entities;
  }

  protected process(players: readonly Entity[]): void {
    //const dt = (this as any).dt || 0;
    const interactPressed = false;

    if (!interactPressed) return;

    for (const player of players) {
      const pTrans = player.getComponent(TransformComponent)!;

      for (const interactable of this.interactables) {
        const iTrans = interactable.getComponent(TransformComponent)!;
        const iComp = interactable.getComponent(InteractableComponent)!;

        const dx = pTrans.x - iTrans.x;
        const dy = pTrans.y - iTrans.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist <= 2) {
          //iComp.radius) {
          console.log(`Player interacted with ${iComp.type}`); //${iComp.interactType}!`);
          // Here you would trigger the logic (e.g., broadcast a message to the client)
        }
      }
    }
  }
}