// app/(app)/page.tsx
"use client";
import { useChat } from "@/components/chat-provider";
import { ChatPage } from "@/components/chat/ChatPage";

export default function Page() {
  const { activeConversation } = useChat();
  if (!activeConversation) return null;
  return <ChatPage key={activeConversation.id} />;
}
