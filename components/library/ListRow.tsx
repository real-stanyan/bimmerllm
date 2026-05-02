// components/library/ListRow.tsx
"use client";
import { I } from "@/components/ui/icons";
import { type Conversation, derivePreview } from "@/lib/conversation";
import { formatRelative } from "@/lib/format";

export function ListRow({ c, onClick }: { c: Conversation; onClick: () => void }) {
  const preview = derivePreview(c.messages);
  const Icon = c.pinned ? I.Pin : c.favorite ? I.Star : I.Chat;
  return (
    <button
      onClick={onClick}
      className="grid items-center gap-4 px-4 py-4 cursor-pointer text-left text-[var(--text-1)] transition-colors border border-[var(--line-1)] -mb-px hover:bg-[var(--bg-3)] hover:border-[var(--line-2)]"
      style={{ gridTemplateColumns: "32px 1fr auto auto 18px" }}
    >
      <div
        className="w-8 h-8 rounded-md flex items-center justify-center"
        style={{ background: "var(--bg-3)", color: "var(--accent-hi)" }}
      >
        <Icon size={12} />
      </div>
      <div className="min-w-0 flex flex-col gap-0.5">
        <div className="text-[13.5px] font-medium text-[var(--text-1)] truncate">{c.title}</div>
        {preview && <div className="text-xs text-[var(--text-3)] truncate">{preview}</div>}
      </div>
      <div className="flex gap-1.5">
        {c.model && <span className="font-mono text-[11px] uppercase tracking-wider px-2 py-0.5 rounded-full bg-[var(--bg-3)] border border-[var(--line-2)] text-[var(--text-2)]">{c.model}</span>}
      </div>
      <div className="text-[11.5px] text-[var(--text-3)] font-mono whitespace-nowrap">{formatRelative(c.updatedAt)}</div>
      <div className="text-[var(--text-3)]"><I.ChevronRight size={13} /></div>
    </button>
  );
}
