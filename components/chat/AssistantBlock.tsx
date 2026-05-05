// components/chat/AssistantBlock.tsx
"use client";
import { useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { SourceCitation } from "@/lib/conversation";
import { parseCitationHref, processInlineCitations } from "@/lib/citations";
import { SourcesPanel } from "./SourcesPanel";
import { ActionsBar } from "./ActionsBar";
import { ThinkingDots } from "./ThinkingDots";

interface Props {
  content: string;
  streaming: boolean;
  sources?: SourceCitation[];
  showSources: boolean;
  thumbsUp?: boolean;
  thumbsDown?: boolean;
  latencyMs?: number;
  tokenCount?: number;
  onRegenerate: () => void;
  onThumbsUp: () => void;
  onThumbsDown: () => void;
}

export function AssistantBlock({
  content, streaming, sources, showSources,
  thumbsUp, thumbsDown, latencyMs, tokenCount,
  onRegenerate, onThumbsUp, onThumbsDown,
}: Props) {
  const sourceCount = sources?.length ?? 0;
  const hasSources = !streaming && content && showSources && sourceCount > 0;

  // Inline citations are rendered as #cite-N links; the components.a override
  // intercepts them and scrolls the matching SourcesPanel entry into view.
  const [sourcesOpen, setSourcesOpen] = useState(true);
  const [highlightedIdx, setHighlightedIdx] = useState<number | null>(null);
  const sourceRefs = useRef<Record<number, HTMLDivElement | null>>({});
  const highlightTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const onCitationClick = (n: number) => {
    if (!sources || n < 1 || n > sources.length) return;
    setSourcesOpen(true);
    // Defer to the next frame so the panel has expanded before we scroll.
    requestAnimationFrame(() => {
      sourceRefs.current[n]?.scrollIntoView({ behavior: "smooth", block: "center" });
      setHighlightedIdx(n);
      if (highlightTimer.current) clearTimeout(highlightTimer.current);
      highlightTimer.current = setTimeout(() => setHighlightedIdx(null), 1400);
    });
  };

  const renderableContent = useMemo(
    () => (sourceCount > 0 ? processInlineCitations(content, sourceCount) : content),
    [content, sourceCount],
  );

  return (
    <div className="flex justify-start gap-3 items-start animate-fadeUp">
      <div
        className="w-7 h-7 shrink-0 rounded-md flex items-center justify-center mt-1"
        style={{
          background: "linear-gradient(135deg, oklch(0.45 0.13 245), oklch(0.30 0.10 250))",
          boxShadow: "0 0 0 1px var(--line-2), 0 4px 10px oklch(0.45 0.13 245 / 0.25)",
        }}
      >
        <div
          className="w-3 h-3 rounded-[3px]"
          style={{
            background: "linear-gradient(135deg, var(--text-1), oklch(0.85 0.05 245))",
            boxShadow: "0 0 8px rgba(255,255,255,0.4)",
          }}
        />
      </div>
      <div className="flex flex-col max-w-[min(720px,78%)] items-start gap-2">
        {!streaming && (
          <div className="flex items-center gap-1.5 text-[11px] text-[var(--text-3)] font-mono">
            <span className="text-[var(--text-1)] font-medium">bimmerllm</span>
            {showSources && sourceCount > 0 && <><span>·</span><span>{sourceCount} sources cited</span></>}
          </div>
        )}
        <div className="text-[var(--text-1)] py-0.5">
          {streaming && !content ? (
            <ThinkingDots />
          ) : (
            <div className="prose text-sm leading-relaxed">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                  a: ({ href, children, ...props }) => {
                    const citationN = parseCitationHref(href);
                    if (citationN !== null) {
                      return (
                        <sup>
                          <a
                            href={href}
                            onClick={e => {
                              e.preventDefault();
                              onCitationClick(citationN);
                            }}
                            className="ml-0.5 px-1 rounded text-[var(--accent)] hover:bg-[var(--accent-soft)] cursor-pointer no-underline text-[10.5px] font-mono"
                          >
                            {children}
                          </a>
                        </sup>
                      );
                    }
                    return (
                      <a
                        href={href}
                        target="_blank"
                        rel="noopener noreferrer"
                        {...props}
                      >
                        {children}
                      </a>
                    );
                  },
                }}
              >
                {renderableContent}
              </ReactMarkdown>
            </div>
          )}
        </div>
        {hasSources && sources && (
          <SourcesPanel
            sources={sources}
            open={sourcesOpen}
            onToggle={setSourcesOpen}
            registerSourceRef={(idx, el) => { sourceRefs.current[idx] = el; }}
            highlightedIdx={highlightedIdx}
          />
        )}
        {!streaming && content && (
          <ActionsBar
            content={content}
            onRegenerate={onRegenerate}
            onThumbsUp={onThumbsUp}
            onThumbsDown={onThumbsDown}
            thumbsUp={thumbsUp}
            thumbsDown={thumbsDown}
            latencyMs={latencyMs}
            tokenCount={tokenCount}
          />
        )}
      </div>
    </div>
  );
}
