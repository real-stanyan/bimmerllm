// components/library/LibraryPage.tsx
"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useChat } from "@/components/chat-provider";
import { getBucket, derivePreview } from "@/lib/conversation";
import { LibraryHeader } from "./LibraryHeader";
import { LibraryFilters, type Filter, type Sort } from "./LibraryFilters";
import { ListView } from "./ListView";
import { GridView } from "./GridView";
import { I } from "@/components/ui/icons";

export function LibraryPage() {
  const router = useRouter();
  const { conversations, setActiveId } = useChat();
  const [filter, setFilter] = useState<Filter>("all");
  const [view, setView] = useState<"list" | "grid">("list");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<Sort>("recent");

  const counts = useMemo(() => ({
    all: conversations.length,
    favorite: conversations.filter(c => c.favorite).length,
    pinned: conversations.filter(c => c.pinned).length,
    today: conversations.filter(c => getBucket(c.updatedAt) === "today").length,
  }), [conversations]);

  const list = useMemo(() => {
    let xs = [...conversations];
    if (filter === "favorite") xs = xs.filter(c => c.favorite);
    if (filter === "pinned") xs = xs.filter(c => c.pinned);
    if (filter === "today") xs = xs.filter(c => getBucket(c.updatedAt) === "today");
    if (query) {
      const q = query.toLowerCase();
      xs = xs.filter(c =>
        (c.title + " " + derivePreview(c.messages) + " " + (c.model || "")).toLowerCase().includes(q)
      );
    }
    if (sort === "recent") xs.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
    if (sort === "alpha") xs.sort((a, b) => a.title.localeCompare(b.title));
    return xs;
  }, [conversations, filter, query, sort]);

  const open = (id: string) => { setActiveId(id); router.push("/"); };

  return (
    <div className="flex-1 h-full overflow-y-auto flex flex-col">
      <LibraryHeader
        total={counts.all}
        favorited={counts.favorite}
        query={query}
        setQuery={setQuery}
        view={view}
        setView={setView}
      />
      <LibraryFilters filter={filter} setFilter={setFilter} sort={sort} setSort={setSort} counts={counts} />
      <div className="px-10 py-6 pb-16">
        {list.length === 0 ? (
          <div className="py-20 flex flex-col items-center gap-3.5 text-[var(--text-3)] text-[13px]">
            <I.Search size={28} />
            <div>No consultations match.</div>
          </div>
        ) : view === "list" ? (
          <ListView items={list} onOpen={open} />
        ) : (
          <GridView items={list} onOpen={open} />
        )}
      </div>
    </div>
  );
}
