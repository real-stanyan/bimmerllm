// components/chat/Topbar.tsx
"use client";
import { I } from "@/components/ui/icons";
import { ModelPicker } from "./ModelPicker";

interface Props {
  title: string;
  isEmpty: boolean;
  vehicleContext: string;
  setVehicleContext: (v: string) => void;
  onBookmark: () => void;
  bookmarked: boolean;
  onRegenerate: () => void;
  canRegenerate: boolean;
}

export function Topbar({
  title, isEmpty, vehicleContext, setVehicleContext,
  onBookmark, bookmarked, onRegenerate, canRegenerate,
}: Props) {
  return (
    <header className="h-[52px] shrink-0 flex items-center justify-between px-6 border-b border-[var(--line-1)] bg-[var(--bg-1)]">
      <div className="flex items-center gap-2 text-[12.5px]">
        <span className="font-mono text-[10.5px] uppercase tracking-wider text-[var(--text-3)]">Consultation</span>
        <I.ChevronRight size={11} className="text-[var(--text-3)]" />
        <span className="text-[var(--text-1)] font-medium">{isEmpty ? "New session" : title}</span>
      </div>
      <div className="flex items-center gap-2">
        <ModelPicker value={vehicleContext} onChange={setVehicleContext} />
        <button
          onClick={onBookmark}
          title={bookmarked ? "Unpin" : "Pin"}
          className={`p-1.5 rounded-md cursor-pointer ${bookmarked ? "text-[var(--accent-hi)]" : "text-[var(--text-2)]"} hover:bg-[var(--bg-3)] hover:text-[var(--text-1)]`}
        >
          <I.Bookmark size={14} />
        </button>
        <button
          onClick={onRegenerate}
          disabled={!canRegenerate}
          title="Regenerate last answer"
          className="p-1.5 rounded-md text-[var(--text-2)] cursor-pointer hover:bg-[var(--bg-3)] hover:text-[var(--text-1)] disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <I.Refresh size={14} />
        </button>
      </div>
    </header>
  );
}
