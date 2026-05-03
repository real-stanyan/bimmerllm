// components/sidebar/Sidebar.tsx
"use client";
import { useState } from "react";
import { Brand } from "./Brand";
import { NavItems } from "./NavItems";
import { NewConsultationButton } from "./NewConsultationButton";
import { SearchBox } from "./SearchBox";
import { ThreadList } from "./ThreadList";
import { UserFooter } from "./UserFooter";

export function SidebarBody() {
  const [query, setQuery] = useState("");
  return (
    <>
      <Brand />
      <NavItems />
      <NewConsultationButton />
      <SearchBox value={query} onChange={setQuery} />
      <ThreadList query={query} />
      <UserFooter />
    </>
  );
}

export function Sidebar() {
  return (
    <aside
      className="hidden md:flex flex-col w-[268px] shrink-0 h-full p-3 border-r border-[var(--line-1)] bg-[var(--bg-2)]"
    >
      <SidebarBody />
    </aside>
  );
}
