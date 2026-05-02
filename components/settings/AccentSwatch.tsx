// components/settings/AccentSwatch.tsx
"use client";
import type { Accent } from "@/lib/theme";

export function AccentSwatch({ id: _id, swatch, active, onClick }: { id: Accent; swatch: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="w-9 h-9 rounded-full cursor-pointer p-0"
      style={{
        background: swatch,
        border: `2px solid ${active ? "var(--text-1)" : "transparent"}`,
        boxShadow: `0 4px 14px ${swatch}`,
      }}
      aria-label={`Accent ${_id}${active ? " (selected)" : ""}`}
    />
  );
}
