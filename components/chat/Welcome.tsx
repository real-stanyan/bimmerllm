// components/chat/Welcome.tsx
"use client";
import { I, type IconName } from "@/components/ui/icons";

const SUGGESTED: { icon: IconName; title: string; body: string }[] = [
  { icon: "Wrench", title: "Diagnose a fault", body: "Decode a CEL, plausibility, or DTC pattern" },
  { icon: "Gauge",  title: "Compare two models", body: "M340i vs 540i — daily comfort, drive feel" },
  { icon: "Bolt",   title: "Tuning consultation", body: "Stage 1 vs Stage 2 on the B58 — what's safe?" },
  { icon: "Doc",    title: "Service interval", body: "When should I change ZF8HP fluid on a 2020+?" },
];

export function Welcome({ onPick }: { onPick: (s: string) => void }) {
  return (
    <div className="max-w-[720px] mx-auto mt-[8vh] flex flex-col gap-7 animate-fadeUp">
      <div className="flex flex-col gap-3.5">
        <h1 className="text-[32px] font-medium tracking-tight leading-tight text-[var(--text-1)]">
          What are we troubleshooting today?
        </h1>
        <p className="text-sm leading-relaxed text-[var(--text-3)] max-w-[540px]">
          A senior-level consultant for BMW ownership — diagnostics, coding, modifications,
          and buying advice. Trained on bimmerpost forum knowledge.
        </p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {SUGGESTED.map((p, i) => {
          const Icon = I[p.icon];
          return (
            <button
              key={i}
              onClick={() => onPick(`${p.title}: ${p.body}`)}
              className="flex items-center gap-3 p-3.5 rounded-xl text-left transition-all bg-[var(--bg-3)] border border-[var(--line-2)] hover:bg-[var(--bg-4)] hover:border-[var(--line-3)] cursor-pointer text-[var(--text-1)]"
            >
              <div
                className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
                style={{ background: "var(--accent-soft)", color: "var(--accent-hi)" }}
              >
                <Icon size={16} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[13px] font-medium text-[var(--text-1)]">{p.title}</div>
                <div className="text-[11.5px] text-[var(--text-3)] mt-0.5">{p.body}</div>
              </div>
              <I.ChevronRight size={13} className="text-[var(--text-3)]" />
            </button>
          );
        })}
      </div>
    </div>
  );
}
