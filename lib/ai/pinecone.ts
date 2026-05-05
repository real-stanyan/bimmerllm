// lib/ai/pinecone.ts
import { Pinecone } from "@pinecone-database/pinecone";

let _client: Pinecone | null = null;
export function pinecone() {
  if (!_client) _client = new Pinecone({ apiKey: process.env.PINECONE_API_KEY! });
  return _client;
}

// v1 (current prod, 8610 thread-level records).
export const BIMMERPOST_INDEX = "bmw-datas";
export const BIMMERPOST_NAMESPACE = "bimmerpost";

// v2 (Phase 2, post-chunk schema). Index/namespace can be overridden via env
// without redeploying — useful while we A/B test.
export const BIMMERPOST_INDEX_V2 = process.env.BIMMERPOST_INDEX_V2 || "bmw-datas-v2";
export const BIMMERPOST_NAMESPACE_V2 = process.env.BIMMERPOST_NAMESPACE_V2 || "bimmerpost";
export const BIMMERPOST_SPARSE_INDEX = process.env.BIMMERPOST_SPARSE_INDEX || "bmw-datas-sparse-v2";

export function bimmerpostNamespace() {
  return pinecone().index(BIMMERPOST_INDEX).namespace(BIMMERPOST_NAMESPACE);
}

export function bimmerpostNamespaceV2() {
  return pinecone().index(BIMMERPOST_INDEX_V2).namespace(BIMMERPOST_NAMESPACE_V2);
}

export function bimmerpostSparseNamespace() {
  return pinecone().index(BIMMERPOST_SPARSE_INDEX).namespace(BIMMERPOST_NAMESPACE_V2);
}

// Reciprocal Rank Fusion — combines two ranked candidate lists into one.
// k=60 is the canonical default from Cormack et al. 2009; smaller k gives the
// top-of-list more weight. The score is purely a relative rank metric, not
// a calibrated probability — the rerank step is what produces final scores.
export function reciprocalRankFusion<T extends { id: string }>(
  rankings: T[][],
  k: number = 60,
): Array<T & { rrfScore: number }> {
  const byId = new Map<string, T & { rrfScore: number }>();
  for (const ranking of rankings) {
    for (let rank = 0; rank < ranking.length; rank++) {
      const item = ranking[rank];
      const inc = 1 / (k + rank + 1); // ranks are 0-indexed; +1 to start at 1
      const existing = byId.get(item.id);
      if (existing) {
        existing.rrfScore += inc;
      } else {
        byId.set(item.id, { ...item, rrfScore: inc });
      }
    }
  }
  return Array.from(byId.values()).sort((a, b) => b.rrfScore - a.rrfScore);
}
