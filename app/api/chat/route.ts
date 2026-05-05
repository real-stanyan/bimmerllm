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
import { bimmerpostNamespace } from "@/lib/ai/pinecone";
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

interface SearchHit {
  _id: string;
  _score: number;
  // answers may be a single string or an array (conversation turns)
  fields?: { answers?: string | string[] };
}
interface SearchResponse {
  result?: { hits: SearchHit[] };
}

interface ChatBody {
  messages: UIMessage[];
  vehicleContext?: string;
}

// Server-only — carries the full source text for the LLM context. The public
// SourceCitation that goes to the client is derived by truncating `text` to
// UI_PREVIEW_CHARS so we never ship the full body over the wire.
interface RetrievedSource {
  id: string;
  score: number;
  text: string;
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

const retrieve = traceable(
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

      const hits = response.result?.hits ?? [];
      return hits.map((h) => {
        const raw = h.fields?.answers ?? "";
        const text = Array.isArray(raw) ? raw.join("\n") : raw;
        return { id: h._id, score: h._score, text };
      });
    } catch (err) {
      console.error("[retrieve] Pinecone search/rerank failed:", err);
      return [];
    }
  },
  { name: "retrieve" }
);

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
    const sources = await retrieve(searchInput);

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

[Reference (source: bimmerpost forums)]:
${contextText}`;

    // Public source shape that goes to the client + persists in localStorage.
    // Truncate to UI_PREVIEW_CHARS so we never ship the full body.
    const publicSources: SourceCitation[] = sources.map((s) => ({
      id: s.id,
      score: s.score,
      preview: s.text.slice(0, UI_PREVIEW_CHARS),
    }));

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
