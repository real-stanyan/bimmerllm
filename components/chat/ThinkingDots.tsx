// components/chat/ThinkingDots.tsx
export function ThinkingDots() {
  const dot = "inline-block w-1.5 h-1.5 rounded-full";
  return (
    <div className="flex items-center gap-1 text-[var(--text-3)] text-[12.5px] font-mono py-0.5">
      <span className={dot} style={{ background: "var(--accent)", animation: "pulseSoft 1.2s ease-in-out infinite" }} />
      <span className={dot} style={{ background: "var(--accent)", animation: "pulseSoft 1.2s ease-in-out infinite", animationDelay: "0.15s" }} />
      <span className={dot} style={{ background: "var(--accent)", animation: "pulseSoft 1.2s ease-in-out infinite", animationDelay: "0.30s" }} />
      <span className="ml-2">Retrieving from bimmerpost, consulting…</span>
    </div>
  );
}
