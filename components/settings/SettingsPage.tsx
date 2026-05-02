// components/settings/SettingsPage.tsx
"use client";
import { useState } from "react";
import { I } from "@/components/ui/icons";
import { PreferencesSection } from "./PreferencesSection";
import { AppearanceSection } from "./AppearanceSection";

const SECTIONS = [
  { id: "preferences", label: "Preferences", icon: I.Settings },
  { id: "appearance", label: "Appearance", icon: I.Sparkle },
] as const;

type SectionId = typeof SECTIONS[number]["id"];

export function SettingsPage() {
  const [section, setSection] = useState<SectionId>("preferences");
  return (
    <div className="flex-1 h-full overflow-y-auto">
      <header className="px-10 pt-9 pb-6 border-b border-[var(--line-1)]">
        <div className="font-mono text-[10.5px] text-[var(--text-3)] uppercase tracking-widest mb-2">Account</div>
        <h1 className="text-[28px] font-medium tracking-tight m-0">Settings</h1>
      </header>
      <div
        className="grid max-w-[1080px] mx-auto gap-10 px-10 pt-7 pb-20"
        style={{ gridTemplateColumns: "200px 1fr" }}
      >
        <nav className="flex flex-col gap-px sticky top-7 self-start h-fit">
          {SECTIONS.map(s => {
            const Icon = s.icon;
            const active = section === s.id;
            return (
              <button
                key={s.id}
                onClick={() => setSection(s.id)}
                className={`flex items-center gap-2.5 px-3 py-2 rounded-md text-[13px] font-normal cursor-pointer text-left transition-colors ${
                  active ? "bg-[var(--bg-3)] text-[var(--text-1)]" : "text-[var(--text-2)] hover:bg-[var(--bg-3)]"
                }`}
              >
                <Icon size={14} />
                <span>{s.label}</span>
                {active && <I.ChevronRight size={12} className="ml-auto" />}
              </button>
            );
          })}
        </nav>
        <div className="min-w-0">
          {section === "preferences" && <PreferencesSection />}
          {section === "appearance" && <AppearanceSection />}
        </div>
      </div>
    </div>
  );
}
