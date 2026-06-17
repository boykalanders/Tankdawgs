import { loadConfig } from "./config.js";
import { createTankDawgsServer } from "./server.js";

const config = loadConfig();
const server = createTankDawgsServer(config);

server.httpServer.listen(config.port, () => {
  console.log(
    `TankDawgs server on :${config.port} ` +
      `(chain ${config.chainEnabled ? "enabled" : "DISABLED — dev mode"}, ` +
      `turn clock ${config.turnClockMs / 1000}s)`
  );
});
