// components/chat-provider.tsx
"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  ReactNode,
} from "react";

const STORAGE_KEY = "bimmerllm_conversations_v1";

interface Message {
  role: "user" | "model";
  content: string;
}

interface Conversation {
  id: string;
  title: string;
  messages: Message[];
  createdAt: string;
  updatedAt: string;
}

interface ChatContextValue {
  conversations: Conversation[];
  activeId: string | null;
  activeConversation: Conversation | null;
  setActiveId: (id: string) => void;
  createConversation: () => void;
  updateActiveConversation: (
    updater: (prev: Conversation) => Conversation
  ) => void;
}

const ChatContext = createContext<ChatContextValue | null>(null);

export function ChatProvider({ children }: { children: ReactNode }) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);

  // 初始化：从 localStorage 读
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed: Conversation[] = JSON.parse(raw);
        if (parsed.length > 0) {
          setConversations(parsed);
          setActiveId(parsed[0].id);
          return;
        }
      }
    } catch (e) {
      console.error("Failed to load conversations", e);
    }

    // 没有数据时创建一个新会话
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const initial: Conversation = {
      id,
      title: "New chat",
      messages: [],
      createdAt: now,
      updatedAt: now,
    };
    setConversations([initial]);
    setActiveId(id);
  }, []);

  // 同步到 localStorage
  useEffect(() => {
    if (conversations.length === 0) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(conversations));
    } catch (e) {
      console.error("Failed to save conversations", e);
    }
  }, [conversations]);

  const activeConversation =
    conversations.find((c) => c.id === activeId) ?? null;

  const createConversation = () => {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const conv: Conversation = {
      id,
      title: "New chat",
      messages: [],
      createdAt: now,
      updatedAt: now,
    };
    setConversations((prev) => [conv, ...prev]);
    setActiveId(id);
  };

  const updateActiveConversation = (
    updater: (prev: Conversation) => Conversation
  ) => {
    setConversations((prev) =>
      prev.map((c) => {
        if (c.id !== activeId) return c;
        const updated = updater(c);
        return {
          ...updated,
          updatedAt: new Date().toISOString(),
        };
      })
    );
  };

  return (
    <ChatContext.Provider
      value={{
        conversations,
        activeId,
        activeConversation,
        setActiveId,
        createConversation,
        updateActiveConversation,
      }}
    >
      {children}
    </ChatContext.Provider>
  );
}

export function useChat() {
  const ctx = useContext(ChatContext);
  if (!ctx) {
    throw new Error("useChat must be used within ChatProvider");
  }
  return ctx;
}
