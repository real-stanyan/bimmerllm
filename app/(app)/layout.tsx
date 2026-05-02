// app/(app)/layout.tsx
import { Sidebar } from "@/components/sidebar/Sidebar";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-svh w-full">
      <Sidebar />
      <main className="flex-1 min-w-0 flex flex-col bg-[var(--bg-1)]">
        {children}
      </main>
    </div>
  );
}
