// lib/conversation.ts
export type StorageRole = "user" | "model";

export interface SourceCitation {
  id: string;
  score: number;
  preview: string;
}

export interface Message {
  role: StorageRole;
  content: string;
  sources?: SourceCitation[];
  thumbsUp?: boolean;
  thumbsDown?: boolean;
  latencyMs?: number;
  tokenCount?: number;
}

export interface Conversation {
  id: string;
  title: string;
  messages: Message[];
  createdAt: string;
  updatedAt: string;
  pinned?: boolean;
  favorite?: boolean;
  model?: string;
}

export type Bucket = "today" | "yesterday" | "week" | "older";

export function migrateConversation(raw: unknown): Conversation | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== "string" || typeof r.title !== "string" || !Array.isArray(r.messages)) {
    return null;
  }
  if (typeof r.createdAt !== "string" || typeof r.updatedAt !== "string") return null;

  return {
    id: r.id,
    title: r.title,
    messages: r.messages as Message[],
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    pinned: typeof r.pinned === "boolean" ? r.pinned : false,
    favorite: typeof r.favorite === "boolean" ? r.favorite : false,
    model: typeof r.model === "string" ? r.model : "Auto-detect",
  };
}

export function getBucket(updatedAt: string, now: Date = new Date()): Bucket {
  const d = new Date(updatedAt);
  const dayMs = 86400 * 1000;
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const startOfYesterday = new Date(startOfToday.getTime() - dayMs);
  const startOfWeekAgo = new Date(startOfToday.getTime() - 7 * dayMs);

  if (d >= startOfToday) return "today";
  if (d >= startOfYesterday) return "yesterday";
  if (d >= startOfWeekAgo) return "week";
  return "older";
}

export function derivePreview(messages: Message[]): string {
  const firstUser = messages.find(m => m.role === "user");
  if (!firstUser) return "";
  const trimmed = firstUser.content.trim().replace(/\s+/g, " ");
  return trimmed.length <= 80 ? trimmed : trimmed.slice(0, 77) + "...";
}
