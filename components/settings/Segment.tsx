// components/settings/Segment.tsx
"use client";

interface Props<T extends string> {
  value: T;
  onChange: (v: T) => void;
  options: { id: T; label: string }[];
}

export function Segment<T extends string>({ value, onChange, options }: Props<T>) {
  return (
    <div className="flex p-0.5 rounded-md" style={{ background: "var(--bg-2)", border: "1px solid var(--line-2)" }}>
      {options.map(o => (
        <button
          key={o.id}
          onClick={() => onChange(o.id)}
          className={`px-3.5 py-1 text-xs font-medium rounded-[5px] cursor-pointer ${
            value === o.id ? "text-[var(--text-1)]" : "text-[var(--text-3)]"
          }`}
          style={{ background: value === o.id ? "var(--bg-3)" : "transparent" }}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
