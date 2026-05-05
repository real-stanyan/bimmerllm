// components/chat/Thread.tsx
"use client";
import { useEffect, useRef } from "react";
import type { Message as StoredMessage } from "@/lib/conversation";
import { Message } from "./Message";

interface Props {
  messages: StoredMessage[];
  streaming: boolean;
  showSources: boolean;
  onRegenerateMessage: (messageId: string) => void;
  onThumbsUp: (idx: number) => void;
  onThumbsDown: (idx: number) => void;
}

export function Thread({ messages, streaming, showSources, onRegenerateMessage, onThumbsUp, onThumbsDown }: Props) {
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length, streaming]);

  return (
    <div className="max-w-[820px] mx-auto flex flex-col gap-5 pb-6">
      {messages.map((m, i) => {
        const isLastAssistant = m.role === "model" && i === messages.length - 1;
        const rowKey = m.id ?? `idx-${i}`;
        return (
          <Message
            key={rowKey}
            m={m}
            streaming={streaming && isLastAssistant}
            showSources={showSources}
            onRegenerate={() => onRegenerateMessage(rowKey)}
            onThumbsUp={() => onThumbsUp(i)}
            onThumbsDown={() => onThumbsDown(i)}
          />
        );
      })}
      <div ref={endRef} className="h-[60px]" />
    </div>
  );
}
