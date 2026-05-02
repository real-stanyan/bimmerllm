// lib/theme.ts
export type Theme = "midnight" | "graphite" | "abyss";
export type Accent = "blue" | "ice" | "violet" | "ember" | "forest";

export const THEMES: { id: Theme; label: string; from: string; to: string }[] = [
  { id: "midnight", label: "Midnight", from: "#0A0A0F", to: "#15151B" },
  { id: "graphite", label: "Graphite", from: "#1A1A1A", to: "#252525" },
  { id: "abyss",    label: "Abyss",    from: "#000004", to: "#0A0A18" },
];

export const ACCENTS: { id: Accent; swatch: string }[] = [
  { id: "blue",   swatch: "oklch(0.68 0.16 245)" },
  { id: "ice",    swatch: "oklch(0.78 0.10 220)" },
  { id: "violet", swatch: "oklch(0.65 0.18 285)" },
  { id: "ember",  swatch: "oklch(0.68 0.18 35)" },
  { id: "forest", swatch: "oklch(0.65 0.13 155)" },
];

const THEME_KEY = "bimmerllm_theme";
const ACCENT_KEY = "bimmerllm_accent";

export function applyTheme(t: Theme) {
  document.documentElement.dataset.theme = t;
  try { localStorage.setItem(THEME_KEY, t); } catch {}
}

export function applyAccent(a: Accent) {
  document.documentElement.dataset.accent = a;
  try { localStorage.setItem(ACCENT_KEY, a); } catch {}
}

export function getStoredTheme(): Theme {
  try {
    const v = localStorage.getItem(THEME_KEY);
    if (v === "midnight" || v === "graphite" || v === "abyss") return v;
  } catch {}
  return "midnight";
}

export function getStoredAccent(): Accent {
  try {
    const v = localStorage.getItem(ACCENT_KEY);
    if (v === "blue" || v === "ice" || v === "violet" || v === "ember" || v === "forest") return v;
  } catch {}
  return "blue";
}
