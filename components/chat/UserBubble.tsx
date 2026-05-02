// components/chat/UserBubble.tsx
export function UserBubble({ content }: { content: string }) {
  return (
    <div className="flex justify-end gap-3 items-start animate-fadeUp">
      <div className="max-w-[min(720px,78%)] flex flex-col gap-2 items-end">
        <div
          className="px-4 py-2.5 text-sm leading-relaxed text-[var(--text-1)]"
          style={{
            background: "var(--bg-3)",
            border: "1px solid var(--line-2)",
            borderRadius: "14px 14px 4px 14px",
          }}
        >
          {content}
        </div>
      </div>
      <div
        className="w-7 h-7 shrink-0 rounded-md flex items-center justify-center text-[11px] font-semibold text-[var(--text-2)] mt-1"
        style={{ background: "var(--bg-3)", border: "1px solid var(--line-2)" }}
      >
        G
      </div>
    </div>
  );
}
