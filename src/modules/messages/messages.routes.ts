import { MessageType } from "@prisma/client";
import { Router } from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import multer from "multer";
import { z } from "zod";
import { prisma } from "../../db/prisma.js";
import { authMiddleware } from "../../middleware/auth.js";
import { asyncHandler, HttpError } from "../../utils/http.js";
import { toMessageDto } from "../../utils/message.js";

const uploadDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../uploads/files");
const upload = multer({ dest: uploadDir });
const router = Router();

router.use(authMiddleware);

const ensureMembership = async (chatId: string, userId: string): Promise<void> => {
  const member = await prisma.chatMember.findFirst({ where: { chatId, userId } });
  if (!member) throw new HttpError(403, "Forbidden");
};

router.get(
  "/chats/:chatId/messages",
  asyncHandler(async (req, res) => {
    const chatId = req.params.chatId;
    await ensureMembership(chatId, req.user!.id);

    const query = z
      .object({
        cursor: z.string().optional(),
        limit: z.coerce.number().min(1).max(100).default(50)
      })
      .parse(req.query);

    const messages = await prisma.message.findMany({
      where: { chatId },
      include: {
        author: { select: { id: true, username: true, avatar: true, displayName: true } },
        reactions: true,
        readBy: true
      },
      orderBy: { createdAt: "desc" },
      take: query.limit + 1,
      ...(query.cursor
        ? {
            cursor: { id: query.cursor },
            skip: 1
          }
        : {})
    });

    const hasMore = messages.length > query.limit;
    const items = hasMore ? messages.slice(0, -1) : messages;
    const nextCursor = hasMore ? items[items.length - 1]?.id ?? null : null;

    const unreadByUser = items
      .filter((message) => message.authorId !== req.user!.id)
      .filter((message) => !message.readBy.some((entry) => entry.userId === req.user!.id))
      .map((message) => ({ userId: req.user!.id, messageId: message.id }));

    if (unreadByUser.length) {
      await prisma.messageRead.createMany({
        data: unreadByUser,
        skipDuplicates: true
      });
    }

    res.json({ data: items.map(toMessageDto), nextCursor });
  })
);

router.post(
  "/chats/:chatId/read",
  asyncHandler(async (req, res) => {
    const chatId = req.params.chatId;
    await ensureMembership(chatId, req.user!.id);

    const unreadMessages = await prisma.message.findMany({
      where: {
        chatId,
        authorId: { not: req.user!.id },
        readBy: { none: { userId: req.user!.id } }
      },
      select: { id: true }
    });

    if (unreadMessages.length) {
      await prisma.messageRead.createMany({
        data: unreadMessages.map((message) => ({
          userId: req.user!.id,
          messageId: message.id
        })),
        skipDuplicates: true
      });

      req.app
        .get("io")
        .to(chatId)
        .emit("messages_read", { chatId, userId: req.user!.id, messageIds: unreadMessages.map((message) => message.id) });
    }

    res.status(200).json({ read: unreadMessages.length });
  })
);

router.post(
  "/chats/:chatId/messages",
  upload.single("file"),
  asyncHandler(async (req, res) => {
    const chatId = req.params.chatId;
    await ensureMembership(chatId, req.user!.id);

    const body = z
      .object({
        content: z.string().trim().max(5000).optional(),
        replyToId: z.string().optional()
      })
      .parse(req.body);

    if (!body.content && !req.file) {
      throw new HttpError(400, "Message must have content or file");
    }

    const message = await prisma.message.create({
      data: {
        chatId,
        authorId: req.user!.id,
        content: body.content,
        replyToId: body.replyToId,
        type: req.file ? (req.file.mimetype.startsWith("image/") ? MessageType.IMAGE : MessageType.FILE) : MessageType.TEXT,
        fileUrl: req.file ? `/uploads/files/${req.file.filename}` : null,
        fileName: req.file?.originalname,
        fileSize: req.file?.size
      },
      include: {
        author: { select: { id: true, username: true, avatar: true, displayName: true } },
        reactions: true,
        readBy: true
      }
    });

    const dto = toMessageDto(message);
    req.app.get("io").to(chatId).emit("new_message", dto);
    res.status(201).json(dto);
  })
);

router.patch(
  "/messages/:id",
  asyncHandler(async (req, res) => {
    const body = z.object({ content: z.string().trim().min(1).max(5000) }).parse(req.body);
    const current = await prisma.message.findUnique({ where: { id: req.params.id } });
    if (!current) throw new HttpError(404, "Message not found");
    if (current.authorId !== req.user!.id) throw new HttpError(403, "Forbidden");

    const updated = await prisma.message.update({
      where: { id: req.params.id },
      data: {
        content: body.content,
        isEdited: true,
        editedAt: new Date()
      },
      include: {
        author: { select: { id: true, username: true, avatar: true, displayName: true } },
        reactions: true,
        readBy: true
      }
    });

    const dto = toMessageDto(updated);
    req.app.get("io").to(updated.chatId).emit("new_message", dto);
    res.json(dto);
  })
);

router.delete(
  "/messages/:id",
  asyncHandler(async (req, res) => {
    const current = await prisma.message.findUnique({ where: { id: req.params.id } });
    if (!current) throw new HttpError(404, "Message not found");
    if (current.authorId !== req.user!.id) throw new HttpError(403, "Forbidden");

    const updated = await prisma.message.update({
      where: { id: req.params.id },
      data: {
        isDeleted: true,
        content: "Message deleted"
      },
      include: {
        author: { select: { id: true, username: true, avatar: true, displayName: true } },
        reactions: true,
        readBy: true
      }
    });

    req.app.get("io").to(updated.chatId).emit("new_message", toMessageDto(updated));
    res.status(204).send();
  })
);

router.post(
  "/messages/:id/reactions",
  asyncHandler(async (req, res) => {
    const body = z.object({ emoji: z.string().min(1).max(10) }).parse(req.body);
    const message = await prisma.message.findUnique({ where: { id: req.params.id } });
    if (!message) throw new HttpError(404, "Message not found");
    await ensureMembership(message.chatId, req.user!.id);

    await prisma.reaction.upsert({
      where: {
        userId_messageId_emoji: {
          userId: req.user!.id,
          messageId: req.params.id,
          emoji: body.emoji
        }
      },
      update: {},
      create: {
        userId: req.user!.id,
        messageId: req.params.id,
        emoji: body.emoji
      }
    });

    const updated = await prisma.message.findUnique({
      where: { id: req.params.id },
      include: {
        author: { select: { id: true, username: true, avatar: true, displayName: true } },
        reactions: true,
        readBy: true
      }
    });
    if (!updated) throw new HttpError(404, "Message not found after reaction");

    req.app.get("io").to(updated.chatId).emit("new_message", toMessageDto(updated));
    res.status(201).json(toMessageDto(updated));
  })
);

export default router;
