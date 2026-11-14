import { Room } from "colyseus";

export class ServerLifecycle {
  private static readonly DELETE_URL = process.env.ARBITRIUM_DELETE_URL;
  private static readonly DELETE_TOKEN = process.env.ARBITRIUM_DELETE_TOKEN;

  /**
   * Call this when all game rounds have ended and the server is idle,
   * or when players vote to restart early.
   */
  public static async requestRestart(reason: string): Promise<void> {
    if (!this.DELETE_URL || !this.DELETE_TOKEN) {
      console.warn("[Lifecycle] Not running on Edgegap; skipping self-stop.");
      return;
    }

    console.log(`[Lifecycle] Restart requested: ${reason}. Stopping deployment...`);

    try {
      const response = await fetch(this.DELETE_URL, {
        method: 'DELETE', // or POST, depending on the exact API spec
        headers: {
          'Authorization': this.DELETE_TOKEN,
        },
      });

      if (response.ok) {
        console.log("[Lifecycle] Self-stop request accepted. The container will shut down.");
        // The process will receive a SIGTERM; Colyseus will handle graceful shutdown.
      } else {
        console.error(`[Lifecycle] Self-stop failed: ${response.status}`);
      }
    } catch (error) {
      console.error("[Lifecycle] Error calling self-stop endpoint:", error);
    }
  }
}