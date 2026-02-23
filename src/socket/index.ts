import type { Server } from "socket.io";
import type { SocketClientToServer, SocketServerToClient } from "../types/shared.js";
import { prisma } from "../db/prisma.js";
import { verifyAccessToken } from "../utils/jwt.js";

export type LumioIo = Server<SocketClientToServer, SocketServerToClient>;

const socketUsers = new Map<string, string>();

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
    socketUsers.set(user.id, socket.id);
    await prisma.user.update({ where: { id: user.id }, data: { isOnline: true } });
    io.emit("user_online", { userId: user.id });

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
      const targetSocketId = socketUsers.get(payload.toUserId);
      if (targetSocketId) io.to(targetSocketId).emit("call_offer", payload);
    });

    socket.on("call_answer", (payload) => {
      const targetSocketId = socketUsers.get(payload.toUserId);
      if (targetSocketId) io.to(targetSocketId).emit("call_answer", payload);
    });

    socket.on("ice_candidate", (payload) => {
      const targetSocketId = socketUsers.get(payload.toUserId);
      if (targetSocketId) io.to(targetSocketId).emit("ice_candidate", payload);
    });

    socket.on("call_end", ({ chatId, toUserId, reason }) => {
      const targetSocketId = socketUsers.get(toUserId);
      if (targetSocketId) io.to(targetSocketId).emit("call_end", { chatId, fromUserId: user.id, reason });
    });

    socket.on("disconnect", async () => {
      socketUsers.delete(user.id);
      const lastSeen = new Date();
      await prisma.user.update({ where: { id: user.id }, data: { isOnline: false, lastSeen } });
      io.emit("user_offline", { userId: user.id, lastSeen: lastSeen.toISOString() });
    });
  });
};
