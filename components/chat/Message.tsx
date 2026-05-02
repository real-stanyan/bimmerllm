// components/chat/Message.tsx
"use client";
import type { Message as StoredMessage } from "@/lib/conversation";
import { UserBubble } from "./UserBubble";
import { AssistantBlock } from "./AssistantBlock";

interface Props {
  m: StoredMessage;
  streaming: boolean;
  showSources: boolean;
  onRegenerate: () => void;
  onThumbsUp: () => void;
  onThumbsDown: () => void;
}

export function Message({ m, streaming, showSources, onRegenerate, onThumbsUp, onThumbsDown }: Props) {
  if (m.role === "user") return <UserBubble content={m.content} />;
  return (
    <AssistantBlock
      content={m.content}
      streaming={streaming}
      sources={m.sources}
      showSources={showSources}
      thumbsUp={m.thumbsUp}
      thumbsDown={m.thumbsDown}
      latencyMs={m.latencyMs}
      tokenCount={m.tokenCount}
      onRegenerate={onRegenerate}
      onThumbsUp={onThumbsUp}
      onThumbsDown={onThumbsDown}
    />
  );
}
