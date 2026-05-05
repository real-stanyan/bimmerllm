// lib/chat-bridge.ts
//
// Bridges between StoredMessage (localStorage shape) and AI SDK's UIMessage shape.
// Storage uses role "user" | "model"; AI SDK uses "user" | "assistant".
// Storage keeps a single content string; AI SDK keeps an array of typed parts.

import type { Message as StoredMessage } from "./conversation";

export interface AiUiMessage {
  id: string;
  role: "user" | "assistant" | "system";
  parts: { type: string; text?: string; data?: unknown }[];
}

// Returns a tight literal shape so it satisfies AI SDK's UIMessage<...> expectations
// when fed into Chat({ messages }). AiUiMessage is intentionally loose to model the
// runtime shape received from useChat (which can carry data-* parts).
export function toAiMessage(m: StoredMessage, idx: number): {
  id: string;
  role: "user" | "assistant";
  parts: { type: "text"; text: string }[];
} {
  return {
    id: m.id ?? `legacy-${idx}`,
    role: m.role === "model" ? "assistant" : "user",
    parts: [{ type: "text", text: m.content }],
  };
}

export function fromAiMessage(m: AiUiMessage): StoredMessage {
  const text = m.parts
    .filter(p => p.type === "text")
    .map(p => p.text ?? "")
    .join("");
  return {
    id: m.id,
    role: m.role === "assistant" ? "model" : "user",
    content: text,
  };
}
