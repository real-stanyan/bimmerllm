// components/sidebar/UserFooter.tsx
"use client";
import { useRouter } from "next/navigation";
import { I } from "@/components/ui/icons";

export function UserFooter() {
  const router = useRouter();
  return (
    <button
      onClick={() => router.push("/settings")}
      className="flex items-center gap-2.5 px-3 py-2.5 -mx-1 border-t border-[var(--line-1)] mt-1.5 cursor-pointer text-[var(--text-2)] transition-colors hover:bg-[var(--bg-3)] w-full text-left"
    >
      <div
        className="w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-semibold text-[var(--text-1)] shrink-0"
        style={{ background: "linear-gradient(135deg, oklch(0.65 0.16 245), oklch(0.50 0.14 250))" }}
      >
        G
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-[12.5px] text-[var(--text-1)] font-medium truncate">Guest</div>
        <div className="text-[10.5px] text-[var(--text-3)] font-mono truncate mt-px">local session</div>
      </div>
      <I.ChevronRight size={14} />
    </button>
  );
}
