import { ChatType, MemberRole, Prisma } from "@prisma/client";
import { Router } from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import multer from "multer";
import { z } from "zod";
import { prisma } from "../../db/prisma.js";
import { authMiddleware } from "../../middleware/auth.js";
import { asyncHandler, HttpError } from "../../utils/http.js";
import type { ChatSummary } from "../../types/shared.js";

const uploadDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../uploads/chats");
const upload = multer({ dest: uploadDir });
const router = Router();

router.use(authMiddleware);

const chatInclude = {
  members: { include: { user: true } },
  messages: {
    include: {
      author: { select: { id: true, username: true, avatar: true, displayName: true } },
      reactions: true,
      readBy: true
    },
    orderBy: { createdAt: "desc" as const },
    take: 1
  }
} satisfies Prisma.ChatInclude;

router.get(
  "/",
  asyncHandler(async (req, res) => {
    const currentUserId = req.user!.id;
    const memberships = await prisma.chatMember.findMany({
      where: { userId: currentUserId, isArchived: false },
      include: { chat: { include: chatInclude } }
    });

    const summariesUnsorted = await Promise.all(
      memberships.map(async (member) => {
        const chat = member.chat;
        const lastMessage = chat.messages[0] ?? null;
        const unreadCount = await prisma.message.count({
          where: {
            chatId: chat.id,
            isDeleted: false,
            authorId: { not: currentUserId },
            readBy: { none: { userId: currentUserId } }
          }
        });
        return {
          id: chat.id,
          type: chat.type,
          name: chat.name,
          avatar: chat.avatar,
          unreadCount,
          lastMessage: lastMessage
            ? {
                id: lastMessage.id,
                content: lastMessage.content,
                type: lastMessage.type,
                fileUrl: lastMessage.fileUrl,
                fileName: lastMessage.fileName,
                fileSize: lastMessage.fileSize,
                isEdited: lastMessage.isEdited,
                isDeleted: lastMessage.isDeleted,
                createdAt: lastMessage.createdAt.toISOString(),
                editedAt: lastMessage.editedAt ? lastMessage.editedAt.toISOString() : null,
                author: lastMessage.author,
                chatId: lastMessage.chatId,
                replyToId: lastMessage.replyToId,
                reactions: [],
                readByUserIds: lastMessage.readBy.map((x) => x.userId)
              }
            : null,
          members: chat.members.map((m) => ({
            id: m.user.id,
            username: m.user.username,
            email: m.user.email,
            displayName: m.user.displayName,
            avatar: m.user.avatar,
            bio: m.user.bio,
            isOnline: m.user.isOnline,
            lastSeen: m.user.lastSeen ? m.user.lastSeen.toISOString() : null
          })),
          isPinned: member.isPinned,
          isMuted: member.isMuted,
          isArchived: member.isArchived
        };
      })
    );

    const summaries: ChatSummary[] = summariesUnsorted
      .filter((chat) => !(chat.type === ChatType.DIRECT && !chat.lastMessage))
      .sort((a, b) => {
        if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1;
        const aTime = a.lastMessage ? new Date(a.lastMessage.createdAt).getTime() : 0;
        const bTime = b.lastMessage ? new Date(b.lastMessage.createdAt).getTime() : 0;
        return bTime - aTime;
      });

    res.json(summaries);
  })
);

router.post(
  "/direct",
  asyncHandler(async (req, res) => {
    const body = z.object({ userId: z.string().min(1) }).parse(req.body);
    if (body.userId === req.user!.id) throw new HttpError(400, "Cannot chat with yourself");

    const existing = await prisma.chat.findFirst({
      where: {
        type: ChatType.DIRECT,
        members: {
          every: {
            userId: { in: [req.user!.id, body.userId] }
          }
        }
      },
      include: { members: true }
    });

    if (existing && existing.members.length === 2) {
      res.json(existing);
      return;
    }

    const chat = await prisma.chat.create({
      data: {
        type: ChatType.DIRECT,
        members: {
          createMany: {
            data: [
              { userId: req.user!.id, role: MemberRole.OWNER },
              { userId: body.userId, role: MemberRole.MEMBER }
            ]
          }
        }
      }
    });
    res.status(201).json(chat);
  })
);

router.post(
  "/group",
  upload.single("avatar"),
  asyncHandler(async (req, res) => {
    const body = z
      .object({
        name: z.string().min(2).max(64),
        memberIds: z
          .string()
          .transform((raw) => raw.split(",").map((x) => x.trim()).filter(Boolean))
      })
      .parse(req.body);

    const uniqueMembers = Array.from(new Set([req.user!.id, ...body.memberIds]));

    const group = await prisma.chat.create({
      data: {
        type: ChatType.GROUP,
        name: body.name,
        avatar: req.file ? `/uploads/chats/${req.file.filename}` : null,
        members: {
          createMany: {
            data: uniqueMembers.map((id) => ({
              userId: id,
              role: id === req.user!.id ? MemberRole.OWNER : MemberRole.MEMBER
            }))
          }
        }
      },
      include: { members: true }
    });

    res.status(201).json(group);
  })
);

router.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const chat = await prisma.chat.findFirst({
      where: {
        id: req.params.id,
        members: { some: { userId: req.user!.id } }
      },
      include: {
        members: {
          include: {
            user: {
              select: {
                id: true,
                username: true,
                email: true,
                displayName: true,
                avatar: true,
                bio: true,
                isOnline: true,
                lastSeen: true
              }
            }
          }
        }
      }
    });

    if (!chat) throw new HttpError(404, "Chat not found");
    res.json(chat);
  })
);

router.patch(
  "/:id",
  upload.single("avatar"),
  asyncHandler(async (req, res) => {
    const body = z
      .object({
        name: z.string().min(2).max(64).optional(),
        isPinned: z.coerce.boolean().optional(),
        isMuted: z.coerce.boolean().optional(),
        isArchived: z.coerce.boolean().optional()
      })
      .parse(req.body);

    const membership = await prisma.chatMember.findFirst({
      where: { chatId: req.params.id, userId: req.user!.id }
    });
    if (!membership) throw new HttpError(403, "Forbidden");

    const chatTarget = await prisma.chat.findUnique({ where: { id: req.params.id }, select: { type: true } });
    if (!chatTarget) throw new HttpError(404, "Chat not found");

    const wantsGroupEdit = Boolean(body.name) || Boolean(req.file);
    if (
      chatTarget.type === ChatType.GROUP &&
      wantsGroupEdit &&
      membership.role !== MemberRole.OWNER &&
      membership.role !== MemberRole.ADMIN
    ) {
      throw new HttpError(403, "Only owner/admin can update group profile");
    }

    const [chat, member] = await prisma.$transaction([
      prisma.chat.update({
        where: { id: req.params.id },
        data: {
          name: body.name,
          avatar: req.file ? `/uploads/chats/${req.file.filename}` : undefined
        }
      }),
      prisma.chatMember.update({
        where: { id: membership.id },
        data: {
          isPinned: body.isPinned,
          isMuted: body.isMuted,
          isArchived: body.isArchived
        }
      })
    ]);

    res.json({ chat, member });
  })
);

router.post(
  "/:id/members",
  asyncHandler(async (req, res) => {
    const body = z.object({ userIds: z.array(z.string().min(1)).min(1) }).parse(req.body);

    const chat = await prisma.chat.findUnique({
      where: { id: req.params.id },
      include: {
        members: true
      }
    });
    if (!chat) throw new HttpError(404, "Chat not found");
    if (chat.type !== ChatType.GROUP) throw new HttpError(400, "Can only add users to group chats");

    const requester = chat.members.find((member) => member.userId === req.user!.id);
    if (!requester) throw new HttpError(403, "Forbidden");
    if (requester.role !== MemberRole.OWNER && requester.role !== MemberRole.ADMIN) {
      throw new HttpError(403, "Only owner/admin can add members");
    }

    const existingUserIds = new Set(chat.members.map((member) => member.userId));
    const userIdsToAdd = body.userIds.filter((userId) => !existingUserIds.has(userId));

    if (!userIdsToAdd.length) {
      res.status(200).json({ added: 0 });
      return;
    }

    await prisma.chatMember.createMany({
      data: userIdsToAdd.map((userId) => ({
        chatId: chat.id,
        userId,
        role: MemberRole.MEMBER
      })),
      skipDuplicates: true
    });

    res.status(201).json({ added: userIdsToAdd.length });
  })
);

router.delete(
  "/:id/members/:userId",
  asyncHandler(async (req, res) => {
    const { id: chatId, userId } = req.params;
    const chat = await prisma.chat.findUnique({
      where: { id: chatId },
      include: { members: true }
    });
    if (!chat) throw new HttpError(404, "Chat not found");
    if (chat.type !== ChatType.GROUP) throw new HttpError(400, "Only group chats support member removal");

    const requester = chat.members.find((member) => member.userId === req.user!.id);
    if (!requester) throw new HttpError(403, "Forbidden");
    if (requester.role !== MemberRole.OWNER && requester.role !== MemberRole.ADMIN) {
      throw new HttpError(403, "Only owner/admin can remove members");
    }

    const target = chat.members.find((member) => member.userId === userId);
    if (!target) throw new HttpError(404, "Member not found");
    if (target.role === MemberRole.OWNER) throw new HttpError(400, "Owner cannot be removed");
    if (target.userId === req.user!.id) throw new HttpError(400, "Use leave chat to remove yourself");

    await prisma.chatMember.delete({ where: { id: target.id } });
    res.status(204).send();
  })
);

router.delete(
  "/:id/leave",
  asyncHandler(async (req, res) => {
    const membership = await prisma.chatMember.findFirst({
      where: { chatId: req.params.id, userId: req.user!.id }
    });
    if (!membership) throw new HttpError(404, "Membership not found");

    await prisma.chatMember.delete({ where: { id: membership.id } });
    res.status(204).send();
  })
);

export default router;
