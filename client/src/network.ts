import { Client } from '@colyseus/sdk';

// Use ws:// for local development, wss:// for production
const SERVER_URL = import.meta.env.DEV
  ? 'ws://localhost:2567'
  : 'wss://your-app-name.koyeb.app';

export async function connectToGame() {
  const client = new Client(SERVER_URL);
  const room = await client.joinOrCreate('my_room');
  console.log('Joined room:', room.roomId);

  // Listen for state changes (e.g., monster positions, player positions)
  room.state.players.onAdd((player: any, sessionId: any) => {
    // Create a Pixi sprite for this player
  });

  return room;
}