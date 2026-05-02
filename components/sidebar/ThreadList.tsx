// components/sidebar/ThreadList.tsx
"use client";
import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { useChat } from "@/components/chat-provider";
import { getBucket, type Conversation, type Bucket } from "@/lib/conversation";
import { ThreadGroup } from "./ThreadGroup";
import { ThreadItem } from "./ThreadItem";

export function ThreadList({ query }: { query: string }) {
  const router = useRouter();
  const { conversations, activeId, setActiveId } = useChat();

  const grouped = useMemo(() => {
    const filtered = conversations.filter(c =>
      !query || c.title.toLowerCase().includes(query.toLowerCase()) ||
      (c.model || "").toLowerCase().includes(query.toLowerCase())
    );
    const pinned = filtered.filter(c => c.pinned);
    const rest = filtered.filter(c => !c.pinned);
    const buckets: Record<Bucket, Conversation[]> = { today: [], yesterday: [], week: [], older: [] };
    rest.forEach(c => buckets[getBucket(c.updatedAt)].push(c));
    return { pinned, ...buckets };
  }, [conversations, query]);

  const open = (id: string) => {
    setActiveId(id);
    router.push("/");
  };

  return (
    <div className="flex-1 overflow-y-auto -mx-1 px-1 no-scrollbar">
      {grouped.pinned.length > 0 && (
        <ThreadGroup label="Pinned" icon="Pin">
          {grouped.pinned.map(c => (
            <ThreadItem key={c.id} c={c} active={c.id === activeId} onClick={() => open(c.id)} />
          ))}
        </ThreadGroup>
      )}
      {grouped.today.length > 0 && (
        <ThreadGroup label="Today">
          {grouped.today.map(c => (
            <ThreadItem key={c.id} c={c} active={c.id === activeId} onClick={() => open(c.id)} />
          ))}
        </ThreadGroup>
      )}
      {grouped.yesterday.length > 0 && (
        <ThreadGroup label="Yesterday">
          {grouped.yesterday.map(c => (
            <ThreadItem key={c.id} c={c} active={c.id === activeId} onClick={() => open(c.id)} />
          ))}
        </ThreadGroup>
      )}
      {grouped.week.length > 0 && (
        <ThreadGroup label="Past 7 days">
          {grouped.week.map(c => (
            <ThreadItem key={c.id} c={c} active={c.id === activeId} onClick={() => open(c.id)} />
          ))}
        </ThreadGroup>
      )}
      {grouped.older.length > 0 && (
        <ThreadGroup label="Older">
          {grouped.older.map(c => (
            <ThreadItem key={c.id} c={c} active={c.id === activeId} onClick={() => open(c.id)} />
          ))}
        </ThreadGroup>
      )}
    </div>
  );
}
