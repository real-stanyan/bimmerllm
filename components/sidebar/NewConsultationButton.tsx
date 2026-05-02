// components/sidebar/NewConsultationButton.tsx
"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useChat } from "@/components/chat-provider";
import { I } from "@/components/ui/icons";

export function NewConsultationButton() {
  const router = useRouter();
  const { createConversation } = useChat();

  const onClick = () => {
    createConversation();
    router.push("/");
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "n") {
        e.preventDefault();
        onClick();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <button
      onClick={onClick}
      className="flex items-center gap-2 px-2.5 py-2 rounded-lg text-[var(--text-1)] text-[13px] font-medium cursor-pointer transition-colors my-1.5 mb-3 w-full"
      style={{
        background: "linear-gradient(180deg, var(--bg-3), var(--bg-2))",
        border: "1px solid var(--line-2)",
      }}
    >
      <I.Plus size={14} />
      <span>New consultation</span>
      <span className="ml-auto flex gap-0.5">
        <span className="kbd">⌘</span>
        <span className="kbd">N</span>
      </span>
    </button>
  );
}
