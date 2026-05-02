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
