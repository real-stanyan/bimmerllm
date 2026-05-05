// components/chat/ChatPage.tsx
//
// AI SDK API surface notes (vs plan assumptions):
//
// PLAN ASSUMED:          ACTUAL @ai-sdk/react@^3 + ai@6 API:
// useChat({ api, body }) useChat({ transport: new DefaultChatTransport({ api, body }), ... })
//                        → api/body are NOT top-level on useChat; they live on the transport.
//                        → Resolution: upgraded root ai@5 → ai@6.0.174 to match @ai-sdk/react.
//                        → body is a Resolvable<object> function (called on each request) so
//                          vehicleContext stays current without recreating the transport.
// useChat({ chat, onFinish })  — when passing a `chat` object, `onFinish` is IGNORED by useChat!
//                        → Fix: pass `onFinish` to the Chat constructor instead. Use a ref to
//                          capture the latest callback so the stable Chat object picks it up.
// onFinish: ({ message }) onFinish: ({ message, messages, isAbort, isDisconnect, isError, finishReason })
//                        → same `message` field, richer callback shape.
// sendMessage({ text })  sendMessage({ text }) ✓ — same
// regenerate()           regenerate()          ✓ — same
// stop()                 stop()                ✓ — same (returns Promise<void>)
// status enum            'submitted'|'streaming'|'ready'|'error' ✓ — same
//
// Sources:
//   The backend emits: writer.write({ type: "data-sources", data: { type: "sources", sources:[...] } })
//   This arrives as a DataUIPart on the assistant message: { type: "data-sources", data: {...} }
//   We read it via message.parts[] filtering for type === "data-sources".

"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useChat as useAiChat, Chat } from "@ai-sdk/react";
import { DefaultChatTransport, type ChatOnFinishCallback, type UIMessage } from "ai";
import { useChat as useChatStore } from "@/components/chat-provider";
import { extractSourcesFromMessage, parseSourcesAnnotation } from "@/lib/sources";
import { fromAiMessage, toAiMessage, type AiUiMessage } from "@/lib/chat-bridge";
import { readPreferences } from "@/lib/preferences";
import { useDisplayMessages } from "@/hooks/useDisplayMessages";
import { Topbar } from "./Topbar";
import { Thread } from "./Thread";
import { Welcome } from "./Welcome";
import { Composer } from "./Composer";

const DISCLAIMER = "bimmerllm references bimmerpost community knowledge. Always verify critical procedures with your service manual.";

export function ChatPage() {
  const {
    activeConversation,
    updateActiveConversation,
    togglePinned,
    setModel,
    setMessages: persistMessages,
  } = useChatStore();

  const [vehicleContext, setVehicleContextState] = useState(activeConversation?.model ?? "Auto-detect");
  const [input, setInput] = useState("");
  const [showSources, setShowSources] = useState(true);
  const streamStartRef = useRef<number | null>(null);
  // vehicleContextRef lets the transport body function always see the latest value
  const vehicleContextRef = useRef(vehicleContext);

  // Keep refs stable for the Chat constructor's onFinish callback
  const activeConversationRef = useRef(activeConversation);
  const persistMessagesRef = useRef(persistMessages);
  const updateActiveConversationRef = useRef(updateActiveConversation);

  // Update refs on every render so the stable onFinish callback sees latest values
  activeConversationRef.current = activeConversation;
  persistMessagesRef.current = persistMessages;
  updateActiveConversationRef.current = updateActiveConversation;
  vehicleContextRef.current = vehicleContext;

  useEffect(() => {
    setShowSources(readPreferences().citations);
  }, []);

  useEffect(() => {
    const model = activeConversation?.model ?? "Auto-detect";
    setVehicleContextState(model);
    vehicleContextRef.current = model;
  }, [activeConversation?.id, activeConversation?.model]);

  const initialMessages = useMemo(
    () => (activeConversation?.messages ?? []).map(toAiMessage),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activeConversation?.id]
  );

  // Stable onFinish callback — reads from refs so it never needs to be re-created.
  // IMPORTANT: onFinish must be passed to the Chat constructor, NOT to useAiChat.
  // When { chat } is passed to useAiChat, useAiChat ignores its own onFinish option.
  const onFinish = useCallback(({ message, messages: allAiMessages }: {
    message: AiUiMessage;
    messages: AiUiMessage[];
    isAbort?: boolean;
    isDisconnect?: boolean;
    isError?: boolean;
  }) => {
    const conv = activeConversationRef.current;
    if (!conv) return;

    const finishedAt = Date.now();
    const latencyMs = streamStartRef.current ? finishedAt - streamStartRef.current : undefined;
    streamStartRef.current = null;

    // Extract sources from the finished message's DataUIPart
    const rawSources = extractSourcesFromMessage(message);
    const sources = parseSourcesAnnotation(rawSources) ?? undefined;

    // allAiMessages is the full conversation state after the turn completes
    // It already includes the assistant message; use it directly.
    const stored = allAiMessages.map(fromAiMessage);

    // Attach latency, token estimate, and sources to the last assistant message
    const lastIdx = stored.length - 1;
    if (stored[lastIdx]?.role === "model") {
      stored[lastIdx] = {
        ...stored[lastIdx],
        sources,
        latencyMs,
        tokenCount: Math.ceil(stored[lastIdx].content.length / 4),
      };
    }

    persistMessagesRef.current(conv.id, stored);

    // Title rule: derive from first user msg if still default
    if (conv.title === "New consultation") {
      const firstUser = stored.find(m => m.role === "user");
      if (firstUser) {
        updateActiveConversationRef.current(c => ({ ...c, title: firstUser.content.slice(0, 50) }));
      }
    }
  }, []);

  // Create the Chat object once per conversation mount (key= remount handles conv switches).
  // body is a Resolvable function so vehicleContext is always current without recreating the transport.
  // onFinish is passed HERE (not to useAiChat) because useAiChat ignores onFinish when { chat } is provided.
  const chat = useMemo(() => {
    const transport = new DefaultChatTransport({
      api: "/api/chat",
      body: () => ({ vehicleContext: vehicleContextRef.current ?? "Auto-detect" }),
    });
    return new Chat({
      transport,
      messages: initialMessages,
      onFinish: onFinish as unknown as ChatOnFinishCallback<UIMessage>,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const {
    messages: aiMessages,
    sendMessage,
    status,
    stop,
    regenerate,
  } = useAiChat({ chat });

  const streaming = status === "streaming" || status === "submitted";

  const onSend = () => {
    if (!input.trim() || !activeConversation) return;
    streamStartRef.current = Date.now();
    void sendMessage({ text: input });
    setInput("");
  };

  const onPick = (text: string) => {
    if (!activeConversation) return;
    streamStartRef.current = Date.now();
    void sendMessage({ text });
    setInput("");
  };

  const storedMessages = activeConversation?.messages ?? [];
  const displayMessages = useDisplayMessages(aiMessages as AiUiMessage[], storedMessages);

  const isEmpty = displayMessages.length === 0;

  const onRegenerate = () => { void regenerate(); };
  const onRegenerateMessage = (messageId: string) => { void regenerate({ messageId }); };

  const onThumbsUp = (idx: number) => {
    if (!activeConversation) return;
    const updated = displayMessages.map((m, i) =>
      i === idx ? { ...m, thumbsUp: !m.thumbsUp, thumbsDown: false } : m
    );
    persistMessages(activeConversation.id, updated);
  };

  const onThumbsDown = (idx: number) => {
    if (!activeConversation) return;
    const updated = displayMessages.map((m, i) =>
      i === idx ? { ...m, thumbsDown: !m.thumbsDown, thumbsUp: false } : m
    );
    persistMessages(activeConversation.id, updated);
  };

  const onModelChange = (v: string) => {
    setVehicleContextState(v);
    vehicleContextRef.current = v;
    if (activeConversation) setModel(activeConversation.id, v);
  };

  return (
    <div className="flex-1 flex flex-col h-full min-w-0">
      <Topbar
        title={activeConversation?.title ?? ""}
        isEmpty={isEmpty}
        vehicleContext={vehicleContext}
        setVehicleContext={onModelChange}
        onBookmark={() => activeConversation && togglePinned(activeConversation.id)}
        bookmarked={activeConversation?.pinned ?? false}
        onRegenerate={onRegenerate}
        canRegenerate={displayMessages.some(m => m.role === "model")}
      />
      <div className="flex-1 overflow-y-auto px-8 pt-8 pb-2 scroll-smooth">
        {isEmpty
          ? <Welcome onPick={onPick} />
          : <Thread
              messages={displayMessages}
              streaming={streaming}
              showSources={showSources}
              onRegenerateMessage={onRegenerateMessage}
              onThumbsUp={onThumbsUp}
              onThumbsDown={onThumbsDown}
            />
        }
      </div>
      <div className="shrink-0 px-6 pt-3 pb-4.5" style={{ background: "linear-gradient(180deg, transparent, var(--bg-1) 30%)" }}>
        <Composer
          value={input}
          onChange={setInput}
          onSend={onSend}
          onStop={() => { void stop(); }}
          streaming={streaming}
          disabled={!activeConversation}
        />
        <p className="text-center text-[var(--text-3)] text-[11px] mt-2 max-w-[640px] mx-auto">{DISCLAIMER}</p>
      </div>
    </div>
  );
}

