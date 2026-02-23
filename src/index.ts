import { createServer } from "node:http";
import { Server } from "socket.io";
import { env } from "./config/env.js";
import { createApp } from "./app.js";
import { prisma } from "./db/prisma.js";
import { setupSocket, type LumioIo } from "./socket/index.js";

const app = createApp();
const server = createServer(app);
const io = new Server(server, {
  cors: {
    origin: env.CLIENT_URL,
    credentials: true
  }
}) as LumioIo;

setupSocket(io);
app.set("io", io);

server.listen(env.PORT, "0.0.0.0", () => {
  process.stdout.write(`Lumio server running at http://localhost:${env.PORT}
`);
});

const shutdown = async (): Promise<void> => {
  await prisma.$disconnect();
  io.close();
  server.close(() => {
    process.exit(0);
  });
};

process.on("SIGTERM", () => void shutdown());
process.on("SIGINT", () => void shutdown());
