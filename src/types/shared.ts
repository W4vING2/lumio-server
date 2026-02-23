export type ChatType = "DIRECT" | "GROUP" | "CHANNEL";
export type MessageType = "TEXT" | "IMAGE" | "FILE" | "AUDIO" | "VIDEO" | "SYSTEM";
export type CallType = "AUDIO" | "VIDEO";

export interface AuthUser {
  id: string;
  username: string;
  email: string;
  displayName: string | null;
  avatar: string | null;
  bio: string | null;
  isOnline: boolean;
  lastSeen: string | null;
}

export interface MessageDto {
  id: string;
  content: string | null;
  type: MessageType;
  fileUrl: string | null;
  fileName: string | null;
  fileSize: number | null;
  isEdited: boolean;
  isDeleted: boolean;
  createdAt: string;
  editedAt: string | null;
  author: Pick<AuthUser, "id" | "username" | "avatar" | "displayName">;
  chatId: string;
  replyToId: string | null;
  reactions: Array<{ emoji: string; count: number; userIds: string[] }>;
  readByUserIds: string[];
}

export interface ChatSummary {
  id: string;
  type: ChatType;
  name: string | null;
  avatar: string | null;
  unreadCount: number;
  lastMessage: MessageDto | null;
  members: AuthUser[];
  isPinned: boolean;
  isMuted: boolean;
  isArchived: boolean;
}

export interface CallSignalPayload {
  chatId: string;
  fromUserId: string;
  toUserId: string;
  sdp: RTCSessionDescriptionInit;
  callType: CallType;
}

export interface IceCandidatePayload {
  chatId: string;
  fromUserId: string;
  toUserId: string;
  candidate: RTCIceCandidateInit;
}

export interface SocketServerToClient {
  new_message: (message: MessageDto) => void;
  user_typing: (payload: { chatId: string; userId: string; username: string; isTyping: boolean }) => void;
  messages_read: (payload: { chatId: string; userId: string; messageIds: string[] }) => void;
  user_online: (payload: { userId: string }) => void;
  user_offline: (payload: { userId: string; lastSeen: string }) => void;
  call_offer: (payload: CallSignalPayload) => void;
  call_answer: (payload: CallSignalPayload) => void;
  ice_candidate: (payload: IceCandidatePayload) => void;
  call_end: (payload: { chatId: string; fromUserId: string; reason: string }) => void;
}

export interface SocketClientToServer {
  join_chat: (payload: { chatId: string }) => void;
  leave_chat: (payload: { chatId: string }) => void;
  send_message: (payload: { chatId: string; content: string; replyToId?: string }) => void;
  typing_start: (payload: { chatId: string }) => void;
  typing_stop: (payload: { chatId: string }) => void;
  message_read: (payload: { chatId: string; messageIds: string[] }) => void;
  call_offer: (payload: CallSignalPayload) => void;
  call_answer: (payload: CallSignalPayload) => void;
  ice_candidate: (payload: IceCandidatePayload) => void;
  call_end: (payload: { chatId: string; toUserId: string; reason: string }) => void;
}
