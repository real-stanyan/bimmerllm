// components/chat/SourcesPanel.tsx
"use client";
import { useState } from "react";
import { I } from "@/components/ui/icons";
import type { SourceCitation } from "@/lib/conversation";

export function SourcesPanel({ sources }: { sources: SourceCitation[] }) {
  const [open, setOpen] = useState(false);
  if (sources.length === 0) return null;
  return (
    <div className="text-xs text-[var(--text-3)]">
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1.5 cursor-pointer hover:text-[var(--text-1)] transition-colors"
      >
        <I.ChevronRight
          size={11}
          style={{ transform: open ? "rotate(90deg)" : "none", transition: "transform 0.15s" }}
        />
        <span>{sources.length} sources cited</span>
      </button>
      {open && (
        <div className="mt-2 flex flex-col gap-2 pl-4 border-l border-[var(--line-2)]">
          {sources.map((s, i) => (
            <div key={s.id + i} className="flex flex-col gap-1">
              <div className="font-mono text-[10.5px] text-[var(--text-3)]">
                #{i + 1} · score {s.score.toFixed(2)} · {s.id}
              </div>
              <div className="text-[12.5px] text-[var(--text-2)] leading-relaxed">{s.preview}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
