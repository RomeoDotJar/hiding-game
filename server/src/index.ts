import { listen } from "@colyseus/tools";
import app from "./app.config.js";
import { USE_LOCALHOST } from "./shared/constants.js";

// This starts the production Colyseus server
listen(app);

// oh my fucking god i hated fixing this latency issue
// if (USE_LOCALHOST)
//    app.simulateLatency(115);