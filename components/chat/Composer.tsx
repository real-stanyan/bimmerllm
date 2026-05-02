// components/chat/Composer.tsx
"use client";
import { I } from "@/components/ui/icons";

interface Props {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  onStop: () => void;
  streaming: boolean;
  disabled: boolean;
}

export function Composer({ value, onChange, onSend, onStop, streaming, disabled }: Props) {
  const canSend = value.trim().length > 0 && !disabled;
  return (
    <div className="max-w-[720px] mx-auto w-full">
      <div
        className="flex items-center gap-1.5 pl-3.5 pr-2 py-2 rounded-full transition-colors"
        style={{
          background: "var(--bg-3)",
          border: "1px solid var(--line-2)",
          boxShadow: "0 8px 24px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.04)",
        }}
      >
        <input
          value={value}
          onChange={e => onChange(e.target.value)}
          onKeyDown={e => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              if (canSend) onSend();
            }
          }}
          placeholder="Ask about a fault, a model, or a procedure…"
          className="flex-1 min-w-0 bg-transparent border-0 outline-none text-[var(--text-1)] text-sm py-1.5"
          disabled={disabled}
        />
        <button
          onClick={() => (streaming ? onStop() : canSend && onSend())}
          disabled={!streaming && !canSend}
          className="w-8 h-8 rounded-full border-0 cursor-pointer flex items-center justify-center shrink-0 transition-colors disabled:cursor-not-allowed"
          style={{
            background: streaming || canSend ? "var(--accent)" : "var(--bg-3)",
            color: streaming || canSend ? "#0A0A0F" : "var(--text-3)",
          }}
        >
          {streaming ? <I.Stop size={13} /> : <I.ArrowUp size={15} />}
        </button>
      </div>
    </div>
  );
}
