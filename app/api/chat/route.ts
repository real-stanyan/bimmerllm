// app/api/chat/route.ts
//
// RAG flow:
//   1. extract latest user question + history
//   2. reformulate to an English search query (skipped when query is already
//      English with no history — saves one Gemini call ~2-4s on the cold path)
//   3. Pinecone searchRecords with inline rerank: dense topK=20 → BGE
//      reranker-v2-m3 → top 5 (multilingual reranker handles CN/EN mix)
//   4. build LLM context from full source text (~4KB/source); send a much
//      shorter `preview` to the client so localStorage stays slim
//   5. streamText with the full context; emit data-sources first, data-usage
//      at the end so the client can show real token counts

import { traceable } from "langsmith/traceable";
import {
  streamText,
  type UIMessage,
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
} from "ai";
import { aiSdkGoogle, GEMINI_MODEL_ID, langchainGemini } from "@/lib/ai/google";
import {
  bimmerpostNamespace,
  bimmerpostNamespaceV2,
  bimmerpostSparseNamespace,
  reciprocalRankFusion,
} from "@/lib/ai/pinecone";
import type { SourceCitation } from "@/lib/conversation";

export const runtime = "nodejs";
export const maxDuration = 60;

// Per-source character budget when assembling the LLM context. ~4KB per
// source × 5 sources = ~20KB, comfortably inside Gemini Flash Lite's 1M
// window while ~17× the previous 240-char preview cap.
const LLM_CONTEXT_PER_SOURCE = 4000;
// What the client sees in SourcesPanel and persists to localStorage. Kept
// short on purpose so chat history doesn't bloat.
const UI_PREVIEW_CHARS = 240;

const RETRIEVE_TOP_K = 20; // pre-rerank candidate pool
const RETRIEVE_TOP_N = 5;  // post-rerank, fed to LLM
const RERANK_MODEL = "bge-reranker-v2-m3";

// v2 toggles. Default OFF — flipping these in Vercel env switches the chat
// route to read from the Phase 2 indexes without redeploy.
const USE_V2 = process.env.BIMMERPOST_USE_V2 === "true";
const USE_HYBRID = process.env.BIMMERPOST_HYBRID === "true" && USE_V2;

interface SearchHit {
  _id: string;
  _score: number;
  // v1 returns answers; v2 returns text + thread_url + thread_title + thread_id.
  fields?: {
    answers?: string | string[];
    text?: string;
    thread_url?: string;
    thread_title?: string;
    thread_id?: number;
  };
}
interface SearchResponse {
  result?: { hits: SearchHit[] };
}

interface ChatBody {
  messages: UIMessage[];
  vehicleContext?: string;
  // Per-request override for which retrieve path to use. The Settings page
  // wires this to the user's preference so they can A/B v1 vs v2 without
  // redeploying. When unset/invalid, falls back to the env-based default.
  retrievalConfig?: "v1" | "v2-dense" | "v2-hybrid";
}

// Server-only — carries the full source text for the LLM context. The public
// SourceCitation that goes to the client is derived by truncating `text` to
// UI_PREVIEW_CHARS so we never ship the full body over the wire.
export interface RetrievedSource {
  id: string;
  score: number;
  text: string;
  url?: string;
  title?: string;
  threadId?: number;          // v2 only — the eval harness uses this for matching
}

function hitToSource(h: SearchHit): RetrievedSource {
  const f = h.fields ?? {};
  // v2 path returns `text` directly; v1 returns `answers` as string|string[]
  let text: string;
  if (typeof f.text === "string") {
    text = f.text;
  } else {
    const raw = f.answers ?? "";
    text = Array.isArray(raw) ? raw.join("\n") : raw;
  }
  return {
    id: h._id,
    score: h._score,
    text,
    url: typeof f.thread_url === "string" && f.thread_url ? f.thread_url : undefined,
    title: typeof f.thread_title === "string" && f.thread_title ? f.thread_title : undefined,
    threadId: typeof f.thread_id === "number" ? f.thread_id : undefined,
  };
}

function extractText(m: UIMessage): string {
  // AI SDK v5+ messages have parts; older entries may carry raw content.
  const anyM = m as unknown as {
    content?: string;
    parts?: { type: string; text?: string }[];
  };
  if (anyM.parts && Array.isArray(anyM.parts)) {
    return anyM.parts
      .filter((p) => p.type === "text")
      .map((p) => p.text ?? "")
      .join("");
  }
  return anyM.content ?? "";
}

// Cheap "is this already an English query?" check — pure ASCII printable
// plus whitespace means no CJK / accented characters, so reformulate would
// mostly be an identity translation. Used only when there's no chat history;
// with history we still rephrase to standalone form regardless of language.
function looksLikeEnglish(s: string): boolean {
  return /^[\x20-\x7E\s]+$/.test(s.trim());
}

const reformulate = traceable(
  async (
    currentQuestion: string,
    history: UIMessage[],
    vehicleContext: string
  ) => {
    const vehicleHint =
      vehicleContext === "Auto-detect" || !vehicleContext
        ? "no specific vehicle"
        : vehicleContext;

    // Fast path: no history + ASCII query → use the question as-is plus a
    // vehicle hint suffix so the search query still carries chassis context.
    if (history.length === 0 && looksLikeEnglish(currentQuestion)) {
      return vehicleHint === "no specific vehicle"
        ? currentQuestion
        : `${currentQuestion} (vehicle: ${vehicleHint})`;
    }

    const prompt =
      history.length === 0
        ? `Translate the following BMW question to an English search query for a forum knowledge base.
User's vehicle context: ${vehicleHint}.
Question: ${currentQuestion}
Output ONLY the English query string.`
        : `Given the following conversation history and a follow-up question, rephrase the follow-up to a standalone English search query for a BMW forum knowledge base.
User's vehicle context: ${vehicleHint}.

Chat history:
${history.map((m) => `${m.role}: ${extractText(m)}`).join("\n")}

Follow-up: ${currentQuestion}

Output ONLY the English query string.`;

    try {
      const res = await langchainGemini.invoke([
        { role: "user", content: prompt },
      ]);
      return res.content?.toString().trim() || currentQuestion;
    } catch (err) {
      console.error("[reformulate] failed, falling back to raw question:", err);
      return currentQuestion;
    }
  },
  { name: "reformulate" }
);

// v1: dense + integrated rerank against bmw-datas/bimmerpost.
export const retrieveV1 = traceable(
  async (searchInput: string): Promise<RetrievedSource[]> => {
    try {
      const ns = bimmerpostNamespace();
      const response = (await ns.searchRecords({
        query: { topK: RETRIEVE_TOP_K, inputs: { text: searchInput } },
        fields: ["answers"],
        rerank: {
          model: RERANK_MODEL,
          topN: RETRIEVE_TOP_N,
          rankFields: ["answers"],
        },
      })) as unknown as SearchResponse;
      return (response.result?.hits ?? []).map(hitToSource);
    } catch (err) {
      console.error("[retrieve.v1] failed:", err);
      return [];
    }
  },
  { name: "retrieve.v1" }
);

// v2 dense-only: bmw-datas-v2 (multilingual integrated embedding) + rerank
// against the chunk text. Used when BIMMERPOST_USE_V2=true and HYBRID=false.
export const retrieveV2Dense = traceable(
  async (searchInput: string): Promise<RetrievedSource[]> => {
    try {
      const ns = bimmerpostNamespaceV2();
      const response = (await ns.searchRecords({
        query: { topK: RETRIEVE_TOP_K, inputs: { text: searchInput } },
        fields: ["text", "thread_url", "thread_title", "thread_id"],
        rerank: {
          model: RERANK_MODEL,
          topN: RETRIEVE_TOP_N,
          rankFields: ["text"],
        },
      })) as unknown as SearchResponse;
      return (response.result?.hits ?? []).map(hitToSource);
    } catch (err) {
      console.error("[retrieve.v2.dense] failed:", err);
      return [];
    }
  },
  { name: "retrieve.v2.dense" }
);

// v2 hybrid: dense + sparse retrieved in parallel, RRF-merged, then reranked.
// Sparse pulls weight on error codes / part numbers / model codes that dense
// embeddings cluster into semantic neighborhoods.
export const retrieveV2Hybrid = traceable(
  async (searchInput: string): Promise<RetrievedSource[]> => {
    try {
      const dense = bimmerpostNamespaceV2();
      const sparse = bimmerpostSparseNamespace();
      const fields = ["text", "thread_url", "thread_title"];
      const [denseRes, sparseRes] = await Promise.all([
        dense.searchRecords({
          query: { topK: 30, inputs: { text: searchInput } },
          fields,
        }) as Promise<unknown>,
        sparse.searchRecords({
          query: { topK: 30, inputs: { text: searchInput } },
          fields,
        }) as Promise<unknown>,
      ]);
      const denseHits = ((denseRes as SearchResponse).result?.hits ?? []).map(hitToSource);
      const sparseHits = ((sparseRes as SearchResponse).result?.hits ?? []).map(hitToSource);

      // RRF merge by hit id, then take top RETRIEVE_TOP_K candidates and
      // hand them to the reranker.
      const fused = reciprocalRankFusion([denseHits, sparseHits]).slice(0, RETRIEVE_TOP_K);

      // Pinecone's inline rerank requires retrieving from a single index, so
      // for hybrid we rerank manually via the Inference API. Fall back to
      // returning the fused ordering on rerank failure.
      try {
        const reranked = await pineconeInferenceRerank(searchInput, fused, RETRIEVE_TOP_N);
        return reranked;
      } catch (rerankErr) {
        console.error("[retrieve.v2.hybrid] rerank failed, falling back to fused:", rerankErr);
        return fused.slice(0, RETRIEVE_TOP_N);
      }
    } catch (err) {
      console.error("[retrieve.v2.hybrid] failed:", err);
      return [];
    }
  },
  { name: "retrieve.v2.hybrid" }
);

// Standalone Pinecone Inference rerank — used by the hybrid path which
// can't lean on the per-index integrated rerank because we're merging two
// indexes' results.
async function pineconeInferenceRerank(
  query: string,
  candidates: RetrievedSource[],
  topN: number,
): Promise<RetrievedSource[]> {
  if (candidates.length === 0) return [];
  const apiKey = process.env.PINECONE_API_KEY;
  if (!apiKey) return candidates.slice(0, topN);
  const res = await fetch("https://api.pinecone.io/rerank", {
    method: "POST",
    headers: {
      "Api-Key": apiKey,
      "Content-Type": "application/json",
      "X-Pinecone-API-Version": "2025-04",
    },
    body: JSON.stringify({
      model: RERANK_MODEL,
      query,
      documents: candidates.map((c, i) => ({ id: String(i), text: c.text.slice(0, 4000) })),
      top_n: topN,
      return_documents: false,
    }),
  });
  if (!res.ok) throw new Error(`pinecone rerank ${res.status}: ${await res.text()}`);
  const json = (await res.json()) as { data?: Array<{ index: number; score: number }> };
  const ranked = (json.data ?? [])
    .map(d => candidates[d.index] ? { ...candidates[d.index], score: d.score } : null)
    .filter((x): x is RetrievedSource => x !== null);
  return ranked;
}

async function retrieve(
  searchInput: string,
  override?: ChatBody["retrievalConfig"],
): Promise<RetrievedSource[]> {
  // Per-request override beats env. Validate against the known set so a
  // typo'd query param can't break retrieval; fall back to env path.
  if (override === "v2-hybrid") return retrieveV2Hybrid(searchInput);
  if (override === "v2-dense") return retrieveV2Dense(searchInput);
  if (override === "v1") return retrieveV1(searchInput);
  if (USE_HYBRID) return retrieveV2Hybrid(searchInput);
  if (USE_V2) return retrieveV2Dense(searchInput);
  return retrieveV1(searchInput);
}

const handler = traceable(
  async (req: Request) => {
    const body = (await req.json()) as ChatBody;
    const messages = body.messages ?? [];
    const vehicleContext = body.vehicleContext || "Auto-detect";

    if (messages.length === 0) {
      return new Response(JSON.stringify({ error: "messages array required" }), {
        status: 400,
      });
    }

    const last = messages[messages.length - 1];
    const history = messages.slice(0, -1);
    const currentQuestion = extractText(last);

    const searchInput = await reformulate(currentQuestion, history, vehicleContext);
    const sources = await retrieve(searchInput, body.retrievalConfig);

    // Per-source slice of the full text — this is what the model sees.
    const contextText =
      sources.length > 0
        ? sources
            .map((s, i) => `[Source ${i + 1}] (id=${s.id}, score=${s.score.toFixed(3)})\n${s.text.slice(0, LLM_CONTEXT_PER_SOURCE)}`)
            .join("\n\n---\n\n")
        : "Reference knowledge base is temporarily unavailable. Answer carefully from your own BMW knowledge.";

    const vehicleHint =
      vehicleContext === "Auto-detect" || !vehicleContext
        ? "no specific vehicle indicated"
        : vehicleContext;

    const system = `You are an expert BMW technical advisor.
Vehicle context: ${vehicleHint}
Answer the user's latest question based on the [Reference] block below.
- Prefer information from the references; if the references do not cover something, explicitly say so.
- When advice depends on the vehicle, target the vehicle context above.
- Reply in the same language as the user's latest message (e.g. Chinese question -> Chinese reply, English question -> English reply). Do not switch language unless the user does.
- CITE YOUR SOURCES INLINE: when you draw a fact, number, or recommendation from a [Source N] block, append \`[N]\` immediately after that statement. Use the exact source number, 1-indexed, matching the reference labels above. Multiple sources for one claim: \`[1][3]\`. Do not invent source numbers — only cite ones that actually appear in the [Reference] block.

[Reference (source: bimmerpost forums)]:
${contextText}`;

    // Public source shape that goes to the client + persists in localStorage.
    // Truncate to UI_PREVIEW_CHARS so we never ship the full body. URL/title
    // are present on v2 retrieves, undefined on v1.
    const publicSources: SourceCitation[] = sources.map((s) => {
      const cite: SourceCitation = {
        id: s.id,
        score: s.score,
        preview: s.text.slice(0, UI_PREVIEW_CHARS),
      };
      if (s.url) cite.url = s.url;
      if (s.title) cite.title = s.title;
      return cite;
    });

    // convertToModelMessages is async in ai@6
    const modelMessages = await convertToModelMessages(messages);

    const stream = createUIMessageStream({
      execute: ({ writer }) => {
        // Emit sources annotation BEFORE the text stream begins.
        // The cast is required because the default UIMessage generic does not
        // carry typed DATA_TYPES — at runtime `data-${string}` is accepted.
        const w = writer as { write: (chunk: unknown) => void };
        w.write({
          type: "data-sources",
          data: { type: "sources", sources: publicSources },
          transient: false,
        });

        const result = streamText({
          model: aiSdkGoogle(GEMINI_MODEL_ID),
          system,
          messages: modelMessages,
          temperature: 0.2,
          onError: (err) => console.error("[generate] streamText error:", err),
          onFinish: ({ usage }) => {
            // Emit real token usage so the client doesn't have to estimate
            // via content.length / 4 (which is ~50% off for Chinese).
            w.write({
              type: "data-usage",
              data: {
                type: "usage",
                inputTokens: usage.inputTokens ?? null,
                outputTokens: usage.outputTokens ?? null,
                totalTokens: usage.totalTokens ?? null,
              },
              transient: false,
            });
          },
        });

        writer.merge(result.toUIMessageStream());
      },
      onError: (err) => {
        console.error("[stream] error:", err);
        return "(An error occurred while generating the response. Please try again.)";
      },
    });

    return createUIMessageStreamResponse({ stream });
  },
  { name: "bmw-rag-route" }
);

export async function POST(req: Request) {
  return handler(req);
}
