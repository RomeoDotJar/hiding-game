import {
  defineServer,
  defineRoom,
  monitor,
  playground,
  createRouter,
  createEndpoint,
  LobbyRoom,
} from "colyseus";

/**
 * Import your Room files
 */
import { MyRoom } from "./rooms/MyRoom.js";


const server = defineServer({

  /**
   * Define your room handlers:
   */
  rooms: {
    my_room: defineRoom(MyRoom).enableRealtimeListing(),
    lobby: defineRoom(LobbyRoom),
  },

  /**
   * Experimental: Define API routes. Built-in integration with the "playground" and SDK.
   *
   * Usage from SDK:
   *   client.http.get("/api/hello").then((response) => {})
   *
   */
  routes: createRouter({
    api_hello: createEndpoint("/api/hello", { method: "GET" }, async (ctx) => {
      return { message: "Hello World" };
    }),
  }),

  /**
   * Bind your custom express routes here:
   * Read more: https://expressjs.com/en/starter/basic-routing.html
   */
  express: (app) => {

    app.get("/hi", (req, res) => {
      res.send("It's time to kick ass and chew bubblegum!");
    });

    /**
     * Use @colyseus/monitor
     * If you expose it in production, make sure to protect it with a password:
     * https://docs.colyseus.io/tools/monitoring#password-protection
     */
    if (process.env.NODE_ENV !== "production") {
      app.use("/monitor", monitor());
    }

    /**
     * Use @colyseus/playground
     * (It is not recommended to expose this route in a production environment)
     */
    if (process.env.NODE_ENV !== "production") {
      app.use("/playground", playground());
    }
  }
});

import { matchMaker } from '@colyseus/core';

// 1. Get the matchmaker instance
const matchmaker = matchMaker;

// 2. Override the CORS headers function
matchmaker.controller.getCorsHeaders = function (headers) {
  // Define the origins you want to allow
  const allowedOrigins = [
    "https://romeodotjar.github.io", // Your production GitHub Pages
    "http://localhost:8080",        // Your local dev client
    "http://localhost:5173"         // Vite's default local port (just in case)
  ];

  const origin = headers.get('origin');
  
  // Check if the request's origin is in our allowed list
  if (allowedOrigins.includes(origin)) {
    return {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Headers": "Origin, X-Requested-With, Content-Type, Accept, Authorization",
      "Access-Control-Allow-Methods": "OPTIONS, POST, GET",
    };
  }
  
  // Fallback to a safe default (or deny, but returning the first origin is safer for now)
  return {
    "Access-Control-Allow-Origin": '',
    "Access-Control-Allow-Headers": "Origin, X-Requested-With, Content-Type, Accept, Authorization",
    "Access-Control-Allow-Methods": "OPTIONS, POST, GET",
  };
};

export default server;

/** Named export read by the `colyseus/vite` plugin's `serverEntry`. */
export { server };