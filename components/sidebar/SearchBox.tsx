// components/sidebar/SearchBox.tsx
"use client";
import { I } from "@/components/ui/icons";

export function SearchBox({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex items-center gap-2 px-2.5 h-8 rounded-md mb-3.5 border border-[var(--line-1)] bg-[var(--bg-1)] text-[var(--text-3)]">
      <I.Search size={14} />
      <input
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder="Search consultations…"
        className="flex-1 min-w-0 bg-transparent border-0 outline-none text-[var(--text-1)] text-[12.5px]"
      />
      {value && (
        <button onClick={() => onChange("")} className="text-[var(--text-3)] cursor-pointer p-0.5 flex items-center hover:text-[var(--text-1)]">
          <I.Close size={12} />
        </button>
      )}
    </div>
  );
}
