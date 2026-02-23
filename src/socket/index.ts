import type { Server } from "socket.io";
import type { SocketClientToServer, SocketServerToClient } from "../types/shared.js";
import { prisma } from "../db/prisma.js";
import { verifyAccessToken } from "../utils/jwt.js";

export type LumioIo = Server<SocketClientToServer, SocketServerToClient>;

const socketUsers = new Map<string, Set<string>>();

const emitToUser = <T>(io: LumioIo, userId: string, event: keyof SocketServerToClient, payload: T): void => {
  const socketIds = socketUsers.get(userId);
  if (!socketIds?.size) return;
  for (const socketId of socketIds) {
    io.to(socketId).emit(event, payload as never);
  }
};

export const setupSocket = (io: LumioIo): void => {
  io.use((socket, next) => {
    const authHeader = socket.handshake.auth.token as string | undefined;
    const cookieToken = socket.handshake.headers.cookie
      ?.split(";")
      .map((segment) => segment.trim())
      .find((segment) => segment.startsWith("accessToken="))
      ?.slice("accessToken=".length);

    const token = authHeader ?? cookieToken;
    if (!token) {
      next(new Error("Unauthorized"));
      return;
    }

    try {
      const user = verifyAccessToken(token);
      socket.data.user = user;
      next();
    } catch {
      next(new Error("Unauthorized"));
    }
  });

  io.on("connection", async (socket) => {
    const user = socket.data.user as { id: string; username: string };
    const userSockets = socketUsers.get(user.id) ?? new Set<string>();
    const isFirstConnection = userSockets.size === 0;
    userSockets.add(socket.id);
    socketUsers.set(user.id, userSockets);

    if (isFirstConnection) {
      await prisma.user.update({ where: { id: user.id }, data: { isOnline: true } });
      io.emit("user_online", { userId: user.id });
    }

    socket.on("join_chat", ({ chatId }) => {
      void socket.join(chatId);
    });

    socket.on("leave_chat", ({ chatId }) => {
      void socket.leave(chatId);
    });

    socket.on("send_message", ({ chatId, content, replyToId }) => {
      void (async () => {
        const message = await prisma.message.create({
          data: { chatId, authorId: user.id, content, replyToId },
          include: {
            author: { select: { id: true, username: true, avatar: true, displayName: true } },
            reactions: true,
            readBy: true
          }
        });
        io.to(chatId).emit("new_message", {
          id: message.id,
          content: message.content,
          type: message.type,
          fileUrl: message.fileUrl,
          fileName: message.fileName,
          fileSize: message.fileSize,
          isEdited: message.isEdited,
          isDeleted: message.isDeleted,
          createdAt: message.createdAt.toISOString(),
          editedAt: message.editedAt ? message.editedAt.toISOString() : null,
          author: message.author,
          chatId: message.chatId,
          replyToId: message.replyToId,
          reactions: [],
          readByUserIds: message.readBy.map((x) => x.userId)
        });
      })();
    });

    socket.on("typing_start", ({ chatId }) => {
      socket.to(chatId).emit("user_typing", { chatId, userId: user.id, username: user.username, isTyping: true });
    });

    socket.on("typing_stop", ({ chatId }) => {
      socket.to(chatId).emit("user_typing", { chatId, userId: user.id, username: user.username, isTyping: false });
    });

    socket.on("message_read", ({ chatId, messageIds }) => {
      void prisma.$transaction(
        messageIds.map((messageId) =>
          prisma.messageRead.upsert({
            where: { userId_messageId: { userId: user.id, messageId } },
            create: { userId: user.id, messageId },
            update: { readAt: new Date() }
          })
        )
      );
      socket.to(chatId).emit("messages_read", { chatId, userId: user.id, messageIds });
    });

    socket.on("call_offer", (payload) => {
      emitToUser(io, payload.toUserId, "call_offer", payload);
    });

    socket.on("call_answer", (payload) => {
      emitToUser(io, payload.toUserId, "call_answer", payload);
    });

    socket.on("ice_candidate", (payload) => {
      emitToUser(io, payload.toUserId, "ice_candidate", payload);
    });

    socket.on("call_end", ({ chatId, toUserId, reason }) => {
      emitToUser(io, toUserId, "call_end", { chatId, fromUserId: user.id, reason });
    });

    socket.on("disconnect", async () => {
      const sockets = socketUsers.get(user.id);
      if (sockets) {
        sockets.delete(socket.id);
        if (!sockets.size) {
          socketUsers.delete(user.id);
          const lastSeen = new Date();
          await prisma.user.update({ where: { id: user.id }, data: { isOnline: false, lastSeen } });
          io.emit("user_offline", { userId: user.id, lastSeen: lastSeen.toISOString() });
        } else {
          socketUsers.set(user.id, sockets);
        }
      }
    });
  });
};
