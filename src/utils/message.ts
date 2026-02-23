import type { Message, Reaction, MessageRead, User } from "@prisma/client";
import type { MessageDto } from "../types/shared.js";

type MessageWithRelations = Message & {
  author: Pick<User, "id" | "username" | "avatar" | "displayName">;
  reactions: Reaction[];
  readBy: MessageRead[];
};

export const toMessageDto = (message: MessageWithRelations): MessageDto => {
  const groupedReactions = new Map<string, { emoji: string; count: number; userIds: string[] }>();
  for (const reaction of message.reactions) {
    const existing = groupedReactions.get(reaction.emoji);
    if (existing) {
      existing.count += 1;
      existing.userIds.push(reaction.userId);
    } else {
      groupedReactions.set(reaction.emoji, { emoji: reaction.emoji, count: 1, userIds: [reaction.userId] });
    }
  }

  return {
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
    reactions: Array.from(groupedReactions.values()),
    readByUserIds: message.readBy.map((entry) => entry.userId)
  };
};
