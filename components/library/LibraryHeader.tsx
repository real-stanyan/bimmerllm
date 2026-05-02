// components/library/LibraryHeader.tsx
"use client";
import { I } from "@/components/ui/icons";

interface Props {
  total: number;
  favorited: number;
  query: string;
  setQuery: (v: string) => void;
  view: "list" | "grid";
  setView: (v: "list" | "grid") => void;
}

export function LibraryHeader({ total, favorited, query, setQuery, view, setView }: Props) {
  return (
    <header className="px-10 pt-9 pb-6 border-b border-[var(--line-1)] flex justify-between items-end gap-6 flex-wrap">
      <div>
        <div className="font-mono text-[10.5px] text-[var(--text-3)] uppercase tracking-widest mb-2">Library</div>
        <h1 className="text-[28px] font-medium tracking-tight m-0 text-[var(--text-1)]">Consultation history</h1>
        <p className="text-[13px] text-[var(--text-3)] mt-2">{total} sessions · {favorited} favorited</p>
      </div>
      <div className="flex items-center gap-2.5">
        <div
          className="flex items-center gap-2 px-3 h-[34px] w-[240px] rounded-lg text-[var(--text-3)]"
          style={{ background: "var(--bg-2)", border: "1px solid var(--line-2)" }}
        >
          <I.Search size={13} />
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search consultations…"
            className="flex-1 bg-transparent border-0 outline-none text-[var(--text-1)] text-[12.5px]"
          />
        </div>
        <div className="flex p-0.5 rounded-lg" style={{ background: "var(--bg-2)", border: "1px solid var(--line-2)" }}>
          <button
            onClick={() => setView("list")}
            className={`w-7 h-7 flex items-center justify-center rounded-md ${view === "list" ? "bg-[var(--bg-3)] text-[var(--text-1)]" : "text-[var(--text-3)]"} cursor-pointer`}
            aria-label="List view"
          >
            <span className="flex flex-col gap-0.5"><span className="w-2.5 h-px bg-current" /><span className="w-2.5 h-px bg-current" /><span className="w-2.5 h-px bg-current" /></span>
          </button>
          <button
            onClick={() => setView("grid")}
            className={`w-7 h-7 flex items-center justify-center rounded-md ${view === "grid" ? "bg-[var(--bg-3)] text-[var(--text-1)]" : "text-[var(--text-3)]"} cursor-pointer`}
            aria-label="Grid view"
          >
            <span className="grid grid-cols-2 gap-0.5 w-2.5 h-2.5"><span className="bg-current" /><span className="bg-current" /><span className="bg-current" /><span className="bg-current" /></span>
          </button>
        </div>
      </div>
    </header>
  );
}
