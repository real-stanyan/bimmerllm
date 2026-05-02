// components/chat/AssistantBlock.tsx
"use client";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { SourceCitation } from "@/lib/conversation";
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
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
            </div>
          )}
        </div>
        {!streaming && content && showSources && sources && sources.length > 0 && (
          <SourcesPanel sources={sources} />
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
