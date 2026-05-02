// lib/preferences.ts

export interface Preferences {
  units: "metric" | "imperial";
  citations: boolean;
  autoModel: boolean;
}

const KEY = "bimmerllm_prefs";
const DEFAULT: Preferences = { units: "metric", citations: true, autoModel: true };

export function readPreferences(): Preferences {
  if (typeof window === "undefined") return DEFAULT;
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULT;
    const parsed = JSON.parse(raw);
    return { ...DEFAULT, ...parsed };
  } catch {
    return DEFAULT;
  }
}

export function writePreferences(p: Preferences) {
  try { localStorage.setItem(KEY, JSON.stringify(p)); } catch {}
}
