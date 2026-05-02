// components/library/GridCard.tsx
"use client";
import { I } from "@/components/ui/icons";
import { type Conversation, derivePreview } from "@/lib/conversation";
import { formatRelative } from "@/lib/format";

export function GridCard({ c, onClick }: { c: Conversation; onClick: () => void }) {
  const preview = derivePreview(c.messages);
  return (
    <button
      onClick={onClick}
      className="flex flex-col gap-2.5 p-4.5 rounded-xl text-left cursor-pointer transition-all min-h-[160px] bg-[var(--bg-3)] border border-[var(--line-2)] text-[var(--text-1)] hover:-translate-y-0.5 hover:border-[var(--line-3)]"
    >
      <div className="flex items-center gap-1.5 text-[var(--text-3)]">
        {c.model && <span className="font-mono text-[11px] uppercase tracking-wider px-2 py-0.5 rounded-full bg-[var(--bg-2)] border border-[var(--line-2)] text-[var(--text-2)]">{c.model}</span>}
        <span className="ml-auto flex gap-1">
          {c.pinned && <I.Pin size={11} />}
          {c.favorite && <span className="text-[var(--accent)]"><I.Star size={11} /></span>}
        </span>
      </div>
      <div className="text-[14.5px] font-medium tracking-tight leading-snug text-[var(--text-1)]">{c.title}</div>
      <div
        className="text-[12.5px] text-[var(--text-3)] leading-relaxed flex-1"
        style={{ display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical", overflow: "hidden" }}
      >
        {preview || "—"}
      </div>
      <div className="flex justify-between items-center pt-2 border-t border-[var(--line-1)] text-[var(--text-3)]">
        <span className="font-mono text-[10.5px]">{formatRelative(c.updatedAt)}</span>
        <I.ChevronRight size={13} />
      </div>
    </button>
  );
}
