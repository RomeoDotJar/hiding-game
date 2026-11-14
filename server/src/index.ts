import { listen } from "@colyseus/tools";
import app from "./app.config.js";

// This starts the production Colyseus server
listen(app);