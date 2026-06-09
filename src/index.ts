import { createServer } from "node:http";
import { Server } from "socket.io";
import { createApp } from "./app.js";
import { env } from "./env.js";
import { registerSocketHandlers } from "./socket/index.js";

const app = createApp();
const httpServer = createServer(app);

const io = new Server(httpServer, {
  // Reflect origin in dev (localhost or LAN IP) — see app.ts for rationale.
  cors: { origin: true, credentials: true },
  // Socket.IO's built-in heartbeat (ping/pong) keeps connections alive and
  // detects drops; tune the interval/timeout here.
  pingInterval: 10000,
  pingTimeout: 20000,
});

registerSocketHandlers(io);

httpServer.listen(env.PORT, () => {
  console.log(`API + Socket.IO listening on http://localhost:${env.PORT}`);
  console.log(`CORS / join links target: ${env.CLIENT_URL}`);
});
