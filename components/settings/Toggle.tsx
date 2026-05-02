// components/settings/Toggle.tsx
"use client";
export function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!on)}
      role="switch"
      aria-checked={on}
      className="w-9 h-5 rounded-full border-0 p-0.5 cursor-pointer flex items-center transition-all"
      style={{
        background: on ? "var(--accent)" : "var(--bg-4)",
        justifyContent: on ? "flex-end" : "flex-start",
      }}
    >
      <span className="w-4 h-4 rounded-full transition-all" style={{ background: "#0A0A0F" }} />
    </button>
  );
}
