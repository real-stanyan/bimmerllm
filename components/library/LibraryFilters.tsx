// components/library/LibraryFilters.tsx
"use client";

export type Filter = "all" | "favorite" | "pinned" | "today";
export type Sort = "recent" | "alpha";

interface Props {
  filter: Filter;
  setFilter: (f: Filter) => void;
  sort: Sort;
  setSort: (s: Sort) => void;
  counts: { all: number; favorite: number; pinned: number; today: number };
}

const items: { id: Filter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "favorite", label: "Favorites" },
  { id: "pinned", label: "Pinned" },
  { id: "today", label: "Today" },
];

export function LibraryFilters({ filter, setFilter, sort, setSort, counts }: Props) {
  return (
    <div className="px-10 py-4 flex justify-between items-center border-b border-[var(--line-1)]">
      <div className="flex gap-1">
        {items.map(it => (
          <button
            key={it.id}
            onClick={() => setFilter(it.id)}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12.5px] font-medium cursor-pointer transition-colors border ${
              filter === it.id
                ? "bg-[var(--bg-3)] text-[var(--text-1)] border-[var(--line-2)]"
                : "bg-transparent text-[var(--text-3)] border-transparent hover:text-[var(--text-1)]"
            }`}
          >
            {it.label}
            <span className="font-mono text-[10px] px-1.5 rounded-full bg-[var(--bg-1)] text-[var(--text-3)]">
              {counts[it.id]}
            </span>
          </button>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <span className="text-[11px] text-[var(--text-3)] font-mono uppercase tracking-wider">Sort</span>
        <select
          value={sort}
          onChange={e => setSort(e.target.value as Sort)}
          className="bg-[var(--bg-3)] border border-[var(--line-2)] rounded-md text-[var(--text-1)] text-xs px-2.5 py-1 cursor-pointer outline-none"
        >
          <option value="recent">Most recent</option>
          <option value="alpha">A → Z</option>
        </select>
      </div>
    </div>
  );
}
