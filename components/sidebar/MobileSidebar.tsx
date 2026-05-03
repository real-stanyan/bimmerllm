// components/sidebar/MobileSidebar.tsx
"use client";
import {
  createContext,
  useCallback,
  useContext,
  useState,
  type MouseEvent,
} from "react";
import { usePathname } from "next/navigation";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { I } from "@/components/ui/icons";
import { SidebarBody } from "./Sidebar";

const MobileSidebarContext = createContext<{ setOpen: (v: boolean) => void } | null>(null);

export function MobileSidebarProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const [lastPathname, setLastPathname] = useState(pathname);

  // Close drawer on route change. Calculating during render is preferred over useEffect
  // for syncing to external values like the URL — see React docs "Storing information
  // from previous renders".
  if (pathname !== lastPathname) {
    setLastPathname(pathname);
    if (open) setOpen(false);
  }

  const onContentClick = useCallback((e: MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement | null;
    if (target?.closest("button, a[href]")) setOpen(false);
  }, []);

  return (
    <MobileSidebarContext.Provider value={{ setOpen }}>
      {children}
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          side="left"
          onClick={onContentClick}
          className="md:hidden p-3 w-[268px] sm:max-w-[268px] bg-[var(--bg-2)] border-r border-[var(--line-1)] flex flex-col gap-0"
        >
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          <SidebarBody />
        </SheetContent>
      </Sheet>
    </MobileSidebarContext.Provider>
  );
}

export function MobileSidebarTrigger({ className = "" }: { className?: string }) {
  const ctx = useContext(MobileSidebarContext);
  if (!ctx) return null;
  return (
    <button
      onClick={() => ctx.setOpen(true)}
      aria-label="Open menu"
      className={`md:hidden p-1.5 rounded-md text-[var(--text-2)] cursor-pointer hover:bg-[var(--bg-3)] hover:text-[var(--text-1)] ${className}`}
    >
      <I.Menu size={16} />
    </button>
  );
}
