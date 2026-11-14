import { listen } from "@colyseus/tools";
import app from "./app.config.js";
import { USE_LOCALHOST } from "./shared/constants.js";

// This starts the production Colyseus server
listen(app);

if (USE_LOCALHOST)
    app.simulateLatency(150);