// components/chat/ModelPicker.tsx
"use client";
import { useState } from "react";
import { I } from "@/components/ui/icons";

const OPTIONS = ["Auto-detect", "335i • E92", "M3 • F80", "M340i • G20", "M5 • F90", "X5 • G05", "M2 • G87", "M3 • E46"];

interface Props {
  value: string;
  onChange: (v: string) => void;
}

export function ModelPicker({ value, onChange }: Props) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-2 px-2.5 py-1.5 rounded-md text-[var(--text-1)] text-xs cursor-pointer"
        style={{ background: "var(--bg-3)", border: "1px solid var(--line-2)" }}
      >
        <I.Car size={13} />
        <span className="font-mono">{value}</span>
        <I.ChevronDown size={11} />
      </button>
      {open && (
        <>
          <div onClick={() => setOpen(false)} className="fixed inset-0 z-30" />
          <div
            className="absolute right-0 mt-1.5 min-w-[200px] z-40 rounded-xl p-1"
            style={{
              background: "var(--bg-elev)",
              border: "1px solid var(--line-2)",
              boxShadow: "var(--shadow-lg)",
            }}
          >
            {OPTIONS.map(o => (
              <button
                key={o}
                onClick={() => { onChange(o); setOpen(false); }}
                className={`flex items-center gap-2 w-full px-2.5 py-1.5 text-xs font-mono rounded-md cursor-pointer text-left ${
                  o === value ? "bg-[var(--bg-3)] text-[var(--text-1)]" : "text-[var(--text-1)] hover:bg-[var(--bg-3)]"
                }`}
              >
                {o === value ? <I.Check size={11} /> : <span className="w-[11px]" />}
                <span>{o}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export const VEHICLE_OPTIONS = OPTIONS;
