// components/settings/ThemeSwatch.tsx
"use client";
import { I } from "@/components/ui/icons";
import type { Theme } from "@/lib/theme";

interface Props {
  id: Theme;
  label: string;
  from: string;
  to: string;
  active: boolean;
  onClick: () => void;
}

export function ThemeSwatch({ id, label, from, to, active, onClick }: Props) {
  return (
    <button
      onClick={onClick}
      className="p-2.5 rounded-xl cursor-pointer flex flex-col gap-2 text-left"
      style={{
        background: "var(--bg-2)",
        border: `1px solid ${active ? "var(--accent)" : "var(--line-2)"}`,
      }}
      aria-label={`Theme ${id}${active ? " (selected)" : ""}`}
    >
      <div
        className="h-16 rounded-md relative"
        style={{ background: `linear-gradient(135deg, ${from}, ${to})` }}
      >
        <div className="absolute inset-2 border border-white/10 rounded" />
      </div>
      <div className="flex justify-between items-center">
        <span className={`text-[12.5px] font-medium ${active ? "text-[var(--text-1)]" : "text-[var(--text-2)]"}`}>{label}</span>
        {active && <I.Check size={12} />}
      </div>
    </button>
  );
}
