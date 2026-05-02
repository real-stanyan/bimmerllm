// components/chat/ActionsBar.tsx
"use client";
import { useState } from "react";
import { I, type IconName } from "@/components/ui/icons";

interface Props {
  content: string;
  onRegenerate: () => void;
  onThumbsUp: () => void;
  onThumbsDown: () => void;
  thumbsUp?: boolean;
  thumbsDown?: boolean;
  latencyMs?: number;
  tokenCount?: number;
}

function ActionBtn({ icon, label, active, onClick }: { icon: IconName; label?: string; active?: boolean; onClick: () => void }) {
  const Icon = I[icon];
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1 px-1.5 py-1 rounded-md text-[11px] cursor-pointer transition-colors ${
        active ? "text-[var(--accent-hi)] bg-[var(--bg-3)]" : "text-[var(--text-3)] hover:text-[var(--text-1)] hover:bg-[var(--bg-3)]"
      }`}
    >
      <Icon size={12} />
      {label && <span>{label}</span>}
    </button>
  );
}

export function ActionsBar({ content, onRegenerate, onThumbsUp, onThumbsDown, thumbsUp, thumbsDown, latencyMs, tokenCount }: Props) {
  const [copied, setCopied] = useState(false);
  const onCopy = async () => {
    try { await navigator.clipboard.writeText(content); setCopied(true); setTimeout(() => setCopied(false), 1500); }
    catch {}
  };
  const meterParts: string[] = [];
  if (latencyMs !== undefined) meterParts.push(`${(latencyMs / 1000).toFixed(1)}s`);
  if (tokenCount !== undefined) meterParts.push(`${tokenCount} tok`);
  const meter = meterParts.join(" · ");

  return (
    <div className="flex items-center gap-1 mt-1">
      <ActionBtn icon="Copy" label={copied ? "Copied" : "Copy"} onClick={onCopy} />
      <ActionBtn icon="Refresh" label="Regenerate" onClick={onRegenerate} />
      <ActionBtn icon="ThumbsUp" active={thumbsUp} onClick={onThumbsUp} />
      <ActionBtn icon="ThumbsDown" active={thumbsDown} onClick={onThumbsDown} />
      {meter && (
        <>
          <span className="w-px h-3 bg-[var(--line-2)] mx-1" />
          <span className="text-[11px] text-[var(--text-3)] font-mono">{meter}</span>
        </>
      )}
    </div>
  );
}
