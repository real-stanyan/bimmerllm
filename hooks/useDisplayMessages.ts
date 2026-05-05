// hooks/useDisplayMessages.ts
//
// Overlays metadata (sources, latency, tokenCount, thumbs) from persisted
// StoredMessages onto the live aiMessages stream. The AI SDK only carries
// text + DataUIParts during streaming — anything we attach in onFinish lives
// only in storage, so the live thread needs to merge them back at render time.
//
// Match strategy: by message.id when both sides have one, else fall back to
// positional alignment (legacy storage rows pre-id may not have stable ids).

import { useMemo } from "react";
import { fromAiMessage, type AiUiMessage } from "@/lib/chat-bridge";
import type { Message as StoredMessage } from "@/lib/conversation";

export function useDisplayMessages(
  aiMessages: AiUiMessage[],
  storedMessages: StoredMessage[]
): StoredMessage[] {
  return useMemo(() => {
    const base: StoredMessage[] =
      aiMessages.length > 0 ? aiMessages.map(fromAiMessage) : storedMessages;

    if (storedMessages.length === 0) return base;

    const byId = new Map<string, StoredMessage>();
    for (const s of storedMessages) {
      if (s.id) byId.set(s.id, s);
    }

    return base.map((m, i) => {
      if (m.role !== "model") return m;
      const stored = (m.id && byId.get(m.id)) || storedMessages[i];
      if (!stored || stored.role !== "model") return m;
      return {
        ...m,
        sources: stored.sources,
        latencyMs: stored.latencyMs,
        tokenCount: stored.tokenCount,
        thumbsUp: stored.thumbsUp,
        thumbsDown: stored.thumbsDown,
      };
    });
  }, [aiMessages, storedMessages]);
}
