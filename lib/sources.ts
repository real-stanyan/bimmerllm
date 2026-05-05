// lib/sources.ts
import type { SourceCitation } from "./conversation";

export type { SourceCitation };

export interface SourcesAnnotation {
  type: "sources";
  sources: SourceCitation[];
}

export function parseSourcesAnnotation(raw: unknown): SourceCitation[] | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (r.type !== "sources" || !Array.isArray(r.sources)) return null;

  const valid = r.sources.filter((s): s is SourceCitation => {
    if (!s || typeof s !== "object") return false;
    const x = s as Record<string, unknown>;
    return typeof x.id === "string" && typeof x.score === "number" && typeof x.preview === "string";
  });

  return valid;
}

// Backend writer.write({ type: "data-sources", data: { type: "sources", sources: [...] } })
// arrives as a DataUIPart on the assistant UIMessage: { type: "data-sources", data: {...} }.
export function extractSourcesFromMessage(message: unknown): unknown {
  if (!message || typeof message !== "object") return null;
  const m = message as Record<string, unknown>;

  if (Array.isArray(m.parts)) {
    for (const p of m.parts) {
      const pp = p as Record<string, unknown>;
      if (pp.type === "data-sources") return pp.data;
    }
  }

  if (Array.isArray(m.annotations)) {
    for (const a of m.annotations) {
      if (a && typeof a === "object" && (a as Record<string, unknown>).type === "sources") return a;
    }
  }

  return null;
}

export interface UsageStats {
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
}

// Companion to extractSourcesFromMessage — pulls the data-usage part written
// from streamText's onFinish so the UI can show real token counts instead of
// the content.length / 4 estimate (which is ~50% off for Chinese text).
export function extractUsageFromMessage(message: unknown): UsageStats | null {
  if (!message || typeof message !== "object") return null;
  const m = message as Record<string, unknown>;
  if (!Array.isArray(m.parts)) return null;

  for (const p of m.parts) {
    const pp = p as Record<string, unknown>;
    if (pp.type !== "data-usage") continue;
    const data = pp.data as Record<string, unknown> | undefined;
    if (!data || data.type !== "usage") continue;
    return {
      inputTokens: typeof data.inputTokens === "number" ? data.inputTokens : null,
      outputTokens: typeof data.outputTokens === "number" ? data.outputTokens : null,
      totalTokens: typeof data.totalTokens === "number" ? data.totalTokens : null,
    };
  }
  return null;
}
