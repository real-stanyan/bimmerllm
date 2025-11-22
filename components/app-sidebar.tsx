// components/app-sidebar.tsx
"use client";

import { PlusCircle } from "lucide-react";
import { useChat } from "@/components/chat-provider";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import Image from "next/image";

export function AppSidebar() {
  const { conversations, activeId, setActiveId, createConversation } =
    useChat();

  return (
    <Sidebar className="w-64 shrink-0">
      <SidebarContent>
        <SidebarGroup>
          <Image
            src={"/logo.webp"}
            width={400}
            height={200}
            alt="logo"
            className="w-full h-auto mb-4 px-1 object-contain"
          />
          <SidebarGroupLabel className="flex items-center justify-between">
            <span>Chats</span>
            <button
              onClick={createConversation}
              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              <PlusCircle className="w-4 h-4" />
              New
            </button>
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {conversations.map((conv) => (
                <SidebarMenuItem key={conv.id}>
                  <SidebarMenuButton
                    asChild
                    isActive={conv.id === activeId}
                    className="justify-start"
                  >
                    <button
                      type="button"
                      onClick={() => setActiveId(conv.id)}
                      className="w-full text-left truncate"
                    >
                      <span className="truncate">
                        {conv.title || "Untitled chat"}
                      </span>
                    </button>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  );
}
