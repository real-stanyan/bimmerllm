// components/library/ListView.tsx
"use client";
import type { Conversation } from "@/lib/conversation";
import { ListRow } from "./ListRow";

export function ListView({ items, onOpen }: { items: Conversation[]; onOpen: (id: string) => void }) {
  return (
    <div className="flex flex-col">
      {items.map(c => <ListRow key={c.id} c={c} onClick={() => onOpen(c.id)} />)}
    </div>
  );
}
