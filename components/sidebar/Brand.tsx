// components/sidebar/Brand.tsx
export function Brand() {
  return (
    <div className="flex items-center gap-2.5 px-2 pb-3.5 pt-2 border-b border-[var(--line-1)] mb-2.5">
      <div
        className="relative w-8 h-8 rounded-lg"
        style={{
          background: "linear-gradient(135deg, oklch(0.45 0.13 245), oklch(0.30 0.10 250))",
          boxShadow: "0 0 0 1px var(--line-2), 0 4px 12px oklch(0.45 0.13 245 / 0.3)",
        }}
      >
        <span className="absolute w-1.5 h-1.5 rounded-[1.5px] bg-[var(--text-1)] opacity-90" style={{ top: 9, left: 9 }} />
        <span className="absolute w-1.5 h-1.5 rounded-[1.5px] bg-[var(--text-1)] opacity-60" style={{ top: 9, left: 17 }} />
        <span className="absolute w-1.5 h-1.5 rounded-[1.5px] bg-[var(--text-1)] opacity-70" style={{ top: 17, left: 13 }} />
      </div>
      <div className="flex flex-col leading-tight">
        <div className="font-semibold text-[13.5px] tracking-tight">bimmerllm</div>
        <div className="font-mono text-[10px] text-[var(--text-3)] mt-0.5">v 0.2 · consultant</div>
      </div>
    </div>
  );
}
