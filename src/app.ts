import cors from "cors";
import cookieParser from "cookie-parser";
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { env } from "./config/env.js";
import authRoutes from "./modules/auth/auth.routes.js";
import usersRoutes from "./modules/users/users.routes.js";
import chatsRoutes from "./modules/chats/chats.routes.js";
import messagesRoutes from "./modules/messages/messages.routes.js";
import callsRoutes from "./modules/calls/calls.routes.js";
import { errorHandler, notFound } from "./middleware/error.js";

export const createApp = (): express.Express => {
  const app = express();
  const uploadsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../uploads");

  app.use(
    cors({
      origin: env.CLIENT_URL,
      credentials: true
    })
  );
  app.use(cookieParser());
  app.use(express.json({ limit: "10mb" }));
  app.use(express.urlencoded({ extended: true }));
  app.use("/uploads", express.static(uploadsDir));

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true });
  });

  app.use("/api/auth", authRoutes);
  app.use("/api/users", usersRoutes);
  app.use("/api/chats", chatsRoutes);
  app.use("/api", messagesRoutes);
  app.use("/api/calls", callsRoutes);

  app.use(notFound);
  app.use(errorHandler);

  return app;
};
