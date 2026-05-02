// components/sidebar/NavItems.tsx
"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { I } from "@/components/ui/icons";

const items = [
  { href: "/", label: "Chat", icon: I.Chat },
  { href: "/library", label: "Library", icon: I.History },
  { href: "/settings", label: "Settings", icon: I.Settings },
] as const;

export function NavItems() {
  const pathname = usePathname() ?? "/";
  return (
    <nav className="flex flex-col gap-px mb-2.5">
      {items.map(({ href, label, icon: Icon }) => {
        const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            className={`flex items-center gap-2.5 px-2.5 py-2 rounded-md text-[13px] font-medium transition-colors ${
              active
                ? "bg-[var(--bg-3)] text-[var(--text-1)]"
                : "text-[var(--text-2)] hover:bg-[var(--bg-3)] hover:text-[var(--text-1)]"
            }`}
          >
            <Icon size={15} />
            <span>{label}</span>
            {active && href === "/" && (
              <span
                className="ml-auto w-1.5 h-1.5 rounded-full"
                style={{ background: "var(--accent)", boxShadow: "0 0 8px var(--accent)" }}
              />
            )}
          </Link>
        );
      })}
    </nav>
  );
}
