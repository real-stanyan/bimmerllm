// components/chat-provider.tsx
"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  ReactNode,
  useCallback,
} from "react";
import {
  type Conversation,
  type Message,
  migrateConversation,
} from "@/lib/conversation";

const STORAGE_KEY = "bimmerllm_conversations_v1";

interface ChatContextValue {
  conversations: Conversation[];
  activeId: string | null;
  activeConversation: Conversation | null;
  setActiveId: (id: string) => void;
  createConversation: () => string;
  updateActiveConversation: (updater: (prev: Conversation) => Conversation) => void;
  togglePinned: (id: string) => void;
  toggleFavorite: (id: string) => void;
  setModel: (id: string, model: string) => void;
  setMessages: (id: string, messages: Message[]) => void;
}

const ChatContext = createContext<ChatContextValue | null>(null);

function loadFromStorage(): Conversation[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map(migrateConversation).filter((c): c is Conversation => c !== null);
  } catch {
    return [];
  }
}

export function ChatProvider({ children }: { children: ReactNode }) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const loaded = loadFromStorage();
    if (loaded.length > 0) {
      setConversations(loaded);
      setActiveId(loaded[0].id);
    } else {
      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      const initial: Conversation = {
        id,
        title: "New consultation",
        messages: [],
        createdAt: now,
        updatedAt: now,
        pinned: false,
        favorite: false,
        model: "Auto-detect",
      };
      setConversations([initial]);
      setActiveId(id);
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated || conversations.length === 0) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(conversations));
    } catch {}
  }, [conversations, hydrated]);

  const activeConversation = conversations.find(c => c.id === activeId) ?? null;

  const createConversation = useCallback(() => {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const conv: Conversation = {
      id,
      title: "New consultation",
      messages: [],
      createdAt: now,
      updatedAt: now,
      pinned: false,
      favorite: false,
      model: "Auto-detect",
    };
    setConversations(prev => [conv, ...prev]);
    setActiveId(id);
    return id;
  }, []);

  const updateActiveConversation = useCallback(
    (updater: (prev: Conversation) => Conversation) => {
      setConversations(prev =>
        prev.map(c => {
          if (c.id !== activeId) return c;
          const updated = updater(c);
          return { ...updated, updatedAt: new Date().toISOString() };
        })
      );
    },
    [activeId]
  );

  const togglePinned = useCallback((id: string) => {
    setConversations(prev =>
      prev.map(c => (c.id === id ? { ...c, pinned: !c.pinned, updatedAt: new Date().toISOString() } : c))
    );
  }, []);

  const toggleFavorite = useCallback((id: string) => {
    setConversations(prev =>
      prev.map(c => (c.id === id ? { ...c, favorite: !c.favorite, updatedAt: new Date().toISOString() } : c))
    );
  }, []);

  const setModel = useCallback((id: string, model: string) => {
    setConversations(prev =>
      prev.map(c => (c.id === id ? { ...c, model, updatedAt: new Date().toISOString() } : c))
    );
  }, []);

  const setMessages = useCallback((id: string, messages: Message[]) => {
    setConversations(prev =>
      prev.map(c => (c.id === id ? { ...c, messages, updatedAt: new Date().toISOString() } : c))
    );
  }, []);

  return (
    <ChatContext.Provider
      value={{
        conversations,
        activeId,
        activeConversation,
        setActiveId,
        createConversation,
        updateActiveConversation,
        togglePinned,
        toggleFavorite,
        setModel,
        setMessages,
      }}
    >
      {children}
    </ChatContext.Provider>
  );
}

export function useChat() {
  const ctx = useContext(ChatContext);
  if (!ctx) throw new Error("useChat must be used within ChatProvider");
  return ctx;
}
