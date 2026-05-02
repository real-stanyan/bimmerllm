// components/settings/AppearanceSection.tsx
"use client";
import { useEffect, useState } from "react";
import {
  THEMES, ACCENTS,
  applyTheme, applyAccent,
  getStoredTheme, getStoredAccent,
  type Theme, type Accent,
} from "@/lib/theme";
import { ThemeSwatch } from "./ThemeSwatch";
import { AccentSwatch } from "./AccentSwatch";

export function AppearanceSection() {
  const [theme, setTheme] = useState<Theme>("midnight");
  const [accent, setAccent] = useState<Accent>("blue");

  useEffect(() => { setTheme(getStoredTheme()); setAccent(getStoredAccent()); }, []);

  const onTheme = (t: Theme) => { setTheme(t); applyTheme(t); };
  const onAccent = (a: Accent) => { setAccent(a); applyAccent(a); };

  return (
    <div className="animate-fadeUp">
      <div className="flex justify-between items-end mb-4.5 gap-4">
        <div>
          <h2 className="text-lg font-medium tracking-tight m-0">Appearance</h2>
          <p className="text-[13px] text-[var(--text-3)] mt-1">Color & material.</p>
        </div>
      </div>
      <div className="rounded-2xl p-5" style={{ background: "var(--bg-3)", border: "1px solid var(--line-2)" }}>
        <div className="text-xs font-semibold text-[var(--text-3)] uppercase tracking-wider font-mono mb-3">Theme</div>
        <div className="grid grid-cols-3 gap-2.5">
          {THEMES.map(t => (
            <ThemeSwatch key={t.id} id={t.id} label={t.label} from={t.from} to={t.to} active={theme === t.id} onClick={() => onTheme(t.id)} />
          ))}
        </div>
        <div className="h-5" />
        <div className="text-xs font-semibold text-[var(--text-3)] uppercase tracking-wider font-mono mb-3">Accent</div>
        <div className="flex gap-2.5">
          {ACCENTS.map(a => (
            <AccentSwatch key={a.id} id={a.id} swatch={a.swatch} active={accent === a.id} onClick={() => onAccent(a.id)} />
          ))}
        </div>
      </div>
    </div>
  );
}
