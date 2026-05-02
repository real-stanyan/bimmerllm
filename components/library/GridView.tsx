// components/library/GridView.tsx
"use client";
import type { Conversation } from "@/lib/conversation";
import { GridCard } from "./GridCard";

export function GridView({ items, onOpen }: { items: Conversation[]; onOpen: (id: string) => void }) {
  return (
    <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))" }}>
      {items.map(c => <GridCard key={c.id} c={c} onClick={() => onOpen(c.id)} />)}
    </div>
  );
}
