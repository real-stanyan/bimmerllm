// components/sidebar/ThreadItem.tsx
"use client";
import { I } from "@/components/ui/icons";
import type { Conversation } from "@/lib/conversation";

interface Props {
  c: Conversation;
  active: boolean;
  onClick: () => void;
}

export function ThreadItem({ c, active, onClick }: Props) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2 px-2 py-1.5 rounded-md w-full text-left transition-colors ${
        active ? "bg-[var(--bg-3)] ring-1 ring-inset ring-[var(--line-2)]" : "bg-transparent hover:bg-[var(--bg-3)]"
      }`}
    >
      <span className="w-3.5 h-3.5 flex items-center justify-center text-[var(--accent)] opacity-80 shrink-0">
        {c.favorite && <I.Star size={9} />}
      </span>
      <div className="flex-1 min-w-0">
        <div className="text-[12.5px] text-[var(--text-1)] font-normal truncate">{c.title}</div>
        {c.model && (
          <div className="text-[10.5px] text-[var(--text-3)] font-mono truncate mt-0.5">{c.model}</div>
        )}
      </div>
    </button>
  );
}
