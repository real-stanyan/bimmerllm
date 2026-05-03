// app/(app)/layout.tsx
import { Sidebar } from "@/components/sidebar/Sidebar";
import { MobileSidebarProvider } from "@/components/sidebar/MobileSidebar";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <MobileSidebarProvider>
      <div className="flex h-svh w-full">
        <Sidebar />
        <main className="flex-1 min-w-0 flex flex-col bg-[var(--bg-1)]">
          {children}
        </main>
      </div>
    </MobileSidebarProvider>
  );
}
