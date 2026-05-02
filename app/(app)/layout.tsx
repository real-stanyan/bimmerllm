// app/(app)/layout.tsx
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-svh w-full">
      <aside className="w-[268px] shrink-0 border-r border-[var(--line-1)] bg-[var(--bg-2)] p-4">
        <div className="text-[var(--text-3)] text-xs font-mono uppercase tracking-wider">sidebar placeholder</div>
      </aside>
      <main className="flex-1 min-w-0 flex flex-col bg-[var(--bg-1)]">
        {children}
      </main>
    </div>
  );
}
