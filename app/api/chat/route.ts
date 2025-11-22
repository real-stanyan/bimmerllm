// app/api/chat/route.ts
import { NextResponse } from "next/server";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { Pinecone } from "@pinecone-database/pinecone";
import { traceable } from "langsmith/traceable";

export const runtime = "nodejs";

// === 接口定义 ===
export interface SearchFields {
  answers?: string;
  [key: string]: any;
}

export interface SearchHit {
  _id: string;
  _score: number;
  fields: SearchFields;
}

export interface SearchResult {
  hits: SearchHit[];
}

export interface SearchUsage {
  readUnits: number;
  embedTotalTokens?: number;
}

export interface SearchResponse {
  result: SearchResult;
  usage?: SearchUsage;
}

// === 初始化 LLM & Pinecone ===
const llm = new ChatGoogleGenerativeAI({
  model: "gemini-2.5-flash-lite",
  apiKey: process.env.GEMINI_API_KEY!,
  temperature: 0.2,
});

const pc = new Pinecone({ apiKey: process.env.PINECONE_API_KEY! });
const namespace = pc.index("bmw-datas").namespace("bimmerpost");

// === 真正的处理函数 ===
async function handler(req: Request) {
  try {
    const { messages } = await req.json();

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return NextResponse.json(
        { error: "messages array is required" },
        { status: 400 }
      );
    }

    const lastMessage = messages[messages.length - 1];
    const historyMessages = messages.slice(0, -1);
    const currentQuestion = lastMessage.content as string;

    // === 1. 生成 searchInput ===
    let searchInput = currentQuestion;

    if (historyMessages.length > 0) {
      const reformulatePrompt = `
        Given the following conversation history and a follow-up question,
        rephrase the follow-up question to be a **standalone English search query**.
        
        Chat History:
        ${historyMessages.map((m: any) => `${m.role}: ${m.content}`).join("\n")}
        
        Follow-up Input: ${currentQuestion}
        
        Instructions:
        1. Combine the history context with the new input.
        2. Translate the core intent into English for a database search.
        3. Output ONLY the English query string, nothing else.
      `;

      const reformulateRes = await llm.invoke([
        { role: "user", content: reformulatePrompt },
      ]);
      searchInput = reformulateRes.content?.toString().trim() || "";
    } else {
      const transRes = await llm.invoke(
        `Translate this into English for search: "${currentQuestion}". Only output English.`
      );
      searchInput = transRes.content?.toString().trim() || "";
    }

    // === 2. Pinecone 检索 ===
    const response = (await namespace.searchRecords({
      query: { topK: 5, inputs: { text: searchInput } },
      fields: ["answers"],
    })) as unknown as SearchResponse;

    const topMatches = response.result?.hits || [];
    const contextText =
      topMatches.length > 0
        ? topMatches.map((m: any) => m.fields?.answers).join("\n\n---\n\n")
        : "No relevant documents found.";

    // === 3. 拼最终 prompt ===
    const finalPrompt = `
      你是一个专业的 BMW 技术顾问。请基于下方的【参考资料】回答用户的最新问题。
      
      【参考资料 (来源: 论坛数据)】:
      ${contextText}
      
      【对话历史】:
      ${historyMessages
        .map((m: any) => `${m.role === "user" ? "用户" : "AI"}: ${m.content}`)
        .join("\n")}
      
      【用户最新问题】:
      ${currentQuestion}
      
      **要求**:
      1. 使用中文回答。
      2. 优先依据【参考资料】的内容。如果资料里没有，请说明。
      3. 结合【对话历史】理解用户的语境（例如用户说"它"指代之前的车型）。
      4. 保持对话风格自然。
    `;

    // === 4. 流式输出 ===
    const encoder = new TextEncoder();
    const { readable, writable } = new TransformStream();

    (async () => {
      const writer = writable.getWriter();
      try {
        const stream = await llm.stream([
          { role: "user", content: finalPrompt },
        ]);

        for await (const chunk of stream) {
          const text = chunk.content?.toString() ?? "";
          if (!text) continue;
          await writer.write(encoder.encode(text));
        }
      } catch (err) {
        console.error("Streaming error:", err);
        await writer.write(
          encoder.encode("（回答过程中发生错误，请稍后重试）")
        );
      } finally {
        writer.close();
      }
    })();

    return new NextResponse(readable, {
      status: 200,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-cache",
      },
    });
  } catch (e: any) {
    console.error(e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

// === 用 LangSmith trace 包一层 ===
const tracedPost = traceable(handler, {
  name: "bmw-rag-route",
});

export { tracedPost as POST };
