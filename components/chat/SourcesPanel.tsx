// components/chat/SourcesPanel.tsx
"use client";
import { I } from "@/components/ui/icons";
import type { SourceCitation } from "@/lib/conversation";
import type { MutableRefObject } from "react";

interface Props {
  sources: SourceCitation[];
  open: boolean;
  onToggle: (next: boolean) => void;
  // AssistantBlock passes a refs map so it can scrollIntoView the right
  // entry when the user clicks an inline [N] citation. Refs are keyed by
  // 1-indexed source number to match the system prompt's [N] convention.
  registerSourceRef?: (idx: number, el: HTMLDivElement | null) => void;
  highlightedIdx?: number | null;
}

export function SourcesPanel({ sources, open, onToggle, registerSourceRef, highlightedIdx }: Props) {
  if (sources.length === 0) return null;
  return (
    <div className="text-xs text-[var(--text-3)]">
      <button
        onClick={() => onToggle(!open)}
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
          {sources.map((s, i) => {
            const idx1 = i + 1;
            const isHighlighted = highlightedIdx === idx1;
            return (
              <div
                key={s.id + i}
                ref={el => registerSourceRef?.(idx1, el)}
                className="flex flex-col gap-1 scroll-mt-24 transition-colors duration-300 rounded-md px-1.5 py-1 -mx-1.5"
                style={isHighlighted ? { background: "var(--accent-soft)" } : undefined}
              >
                <div className="font-mono text-[10.5px] text-[var(--text-3)]">
                  #{idx1} · score {s.score.toFixed(2)} · {s.id}
                </div>
                {s.title && (
                  s.url ? (
                    <a
                      href={s.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[12.5px] text-[var(--text-1)] hover:text-[var(--accent)] underline decoration-[var(--line-3)] underline-offset-2 transition-colors"
                    >
                      {s.title}
                    </a>
                  ) : (
                    <span className="text-[12.5px] text-[var(--text-1)]">{s.title}</span>
                  )
                )}
                <div className="text-[12.5px] text-[var(--text-2)] leading-relaxed">{s.preview}</div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// Re-export the props type for consumers that want to assign refs directly.
export type SourceRefMap = MutableRefObject<Record<number, HTMLDivElement | null>>;
