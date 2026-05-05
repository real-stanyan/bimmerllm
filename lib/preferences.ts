// lib/preferences.ts

export type RetrievalConfig = "v1" | "v2-dense" | "v2-hybrid";

export interface Preferences {
  units: "metric" | "imperial";
  citations: boolean;
  autoModel: boolean;
  // Per-request override for which Pinecone retrieval path to use. Default
  // "v1" matches the long-tail expectation (current prod corpus). Setting
  // to v2-* requires the bmw-datas-v2 / bmw-datas-sparse-v2 indexes to
  // exist; the chat route falls back to v1 silently if they don't.
  retrievalConfig: RetrievalConfig;
}

const KEY = "bimmerllm_prefs";
const DEFAULT: Preferences = {
  units: "metric",
  citations: true,
  autoModel: true,
  retrievalConfig: "v1",
};

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
