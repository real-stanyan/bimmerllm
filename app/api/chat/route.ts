// app/api/chat/route.ts
//
// Implementation path: PATH A (preferred per plan)
// Uses createUIMessageStream + createUIMessageStreamResponse from ai@5.0.98.
// Sources emitted as a `data-sources` chunk BEFORE the text stream starts.
// Client reads sources from message.parts (DataUIPart with type "data-sources").
//
// Verified that createUIMessageStream, createUIMessageStreamResponse,
// streamText, and convertToModelMessages are all exported from ai@5.0.98.

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

interface SearchHit {
  _id: string;
  _score: number;
  // answers is stored as an array of strings (conversation turns) in Pinecone
  fields?: { answers?: string | string[] };
}
interface SearchResponse {
  result?: { hits: SearchHit[] };
}

interface ChatBody {
  messages: UIMessage[];
  vehicleContext?: string;
}

function extractText(m: UIMessage): string {
  // AI SDK v5 messages have parts; older entries may carry raw content.
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
  async (searchInput: string): Promise<SourceCitation[]> => {
    try {
      const ns = bimmerpostNamespace();
      const response = (await ns.searchRecords({
        query: { topK: 5, inputs: { text: searchInput } },
        fields: ["answers"],
      })) as unknown as SearchResponse;

      const hits = response.result?.hits ?? [];
      return hits.map((h) => {
        const raw = h.fields?.answers ?? "";
        // answers may be a string or an array of strings (conversation turns)
        const text = Array.isArray(raw) ? raw.join("\n") : raw;
        return {
          id: h._id,
          score: h._score,
          preview: text.slice(0, 240),
        };
      });
    } catch (err) {
      console.error("[retrieve] Pinecone search failed:", err);
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

    const contextText =
      sources.length > 0
        ? sources.map((s) => s.preview).join("\n\n---\n\n")
        : "参考资料库暂时无法访问。请基于你已有的 BMW 知识谨慎回答。";

    const vehicleHint =
      vehicleContext === "Auto-detect" || !vehicleContext
        ? "用户未指定具体车型"
        : vehicleContext;

    const system = `你是一个专业的 BMW 技术顾问。
用户车辆背景: ${vehicleHint}
请基于下方【参考资料】回答用户的最新问题。
- 优先依据参考资料；资料里没有的内容明确说"参考资料中未涉及"。
- 用户车辆相关的部分要针对那个车型给具体建议。
- 用中文回答。

【参考资料 (来源: bimmerpost 论坛)】:
${contextText}`;

    // convertToModelMessages is async in ai@6
    const modelMessages = await convertToModelMessages(messages);

    const stream = createUIMessageStream({
      execute: ({ writer }) => {
        // Emit sources annotation BEFORE the text stream begins.
        // The type cast is required because the default UIMessage generic does not
        // carry typed DATA_TYPES — at runtime `data-${string}` is accepted by the
        // stream writer; the cast keeps TypeScript happy.
        (writer as { write: (chunk: unknown) => void }).write({
          type: "data-sources",
          data: { type: "sources", sources },
          transient: false,
        });

        const result = streamText({
          model: aiSdkGoogle(GEMINI_MODEL_ID),
          system,
          messages: modelMessages,
          temperature: 0.2,
          onError: (err) => console.error("[generate] streamText error:", err),
        });

        writer.merge(result.toUIMessageStream());
      },
      onError: (err) => {
        console.error("[stream] error:", err);
        return "（回答过程中发生错误，请稍后重试）";
      },
    });

    return createUIMessageStreamResponse({ stream });
  },
  { name: "bmw-rag-route" }
);

export async function POST(req: Request) {
  return handler(req);
}
