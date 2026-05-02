# bimmerllm

BMW 知识 RAG 聊天机器人。中文问答，资料来自 bimmerpost 论坛 Q&A（已灌进 Pinecone）。

## Stack
- Next.js 16 (App Router) + React 19
- Tailwind v4 + shadcn (new-york style, neutral base)
- LangChain 1.0-alpha (`@langchain/google-genai` / `@langchain/community` / `langchain`)
- Pinecone v6 (managed embedding via `searchRecords`)
- Gemini 2.5 Flash Lite (`@google/generative-ai`)
- LangSmith trace（`langsmith/traceable`，目前是 transitive 依赖没列在 package.json）
- AI SDK v5 装了但**没用**（`ai@5.0.98`，前端手写 fetch + reader.read）

## RAG 流程（`app/api/chat/route.ts`）

1. 收 `messages: [{role, content}]`
2. **Reformulate**：有历史 → Gemini 把当前问改写成 standalone **English** query；无历史 → 直接 translate 当前问到英文
3. **Retrieve**：`pc.index("bmw-datas").namespace("bimmerpost").searchRecords({ query: { topK: 5, inputs: { text: searchInput } }, fields: ["answers"] })`
4. **Generate**：拼中文 system prompt（要求中文回答 + 优先依据参考资料 + 结合历史）→ Gemini `llm.stream()`
5. **Stream**：纯 text encoder → `TransformStream` → `text/plain; charset=utf-8`（**不是** SSE / AI SDK protocol）
6. 整个 handler 被 `traceable({ name: "bmw-rag-route" })` 包了一层走 LangSmith

## 前端

- `app/page.tsx` 单页 ChatPage：`fetch("/api/chat")` → `res.body.getReader()` → `decoder.decode()` → 一段一段 append 到最后一条 model 消息
- `components/chat-provider.tsx` ChatProvider：localStorage key `bimmerllm_conversations_v1` 持久化多会话；首次创建 default conv；activeId 切换
- `components/app-sidebar.tsx` shadcn Sidebar 列会话 + "+ New" 按钮
- `app/layout.tsx` 把 ChatProvider + SidebarProvider 包在 root，`<AppSidebar />` 固定 w-64 + `<main>` flex-1
- ReactMarkdown + remarkGfm 渲染助手消息（自定义 ul/ol/h1/h2/h3/p/a/blockquote/code/pre/table 样式）

## 目录布局

```
app/
  api/chat/route.ts   ← 唯一 API，整个 RAG 流程
  page.tsx            ← chat UI
  layout.tsx          ← Sidebar + ChatProvider 包裹
  globals.css
components/
  app-sidebar.tsx
  chat-provider.tsx
  ui/                 ← shadcn 7 件（button/input/separator/sheet/sidebar/skeleton/tooltip）
hooks/
  use-mobile.ts
lib/
  agent.ts            ← createAgent + weather tool（未引用，死代码）
  pinecone.ts         ← getBmwIndex helper（未引用，且 index/namespace 跟 route.ts 对不上）
  utils.ts            ← cn()
public/               ← logo.webp / logo_small.webp / 等
```

## 环境变量（`.env.local` 需要）

代码里硬 `process.env.X!` 的：
- `GEMINI_API_KEY`
- `PINECONE_API_KEY`

LangSmith trace 要全工作还要：
- `LANGSMITH_API_KEY`
- `LANGSMITH_TRACING=true`
- `LANGSMITH_PROJECT`（按需）

⚠️ **当前 repo 没 `.env*` 文件**，第一次跑前先建。

## Pinecone 索引

- Index: `bmw-datas`
- Namespace: `bimmerpost`
- 用 managed embedding（`searchRecords` 不需要本地 embed），返回 `fields.answers` 文本
- **Ingest pipeline 不在这个 repo**——数据预先灌好的，灌库脚本/notebook 在别处

## 已知遗留 / 不一致（首批清理目标）

1. **`lib/agent.ts` 是死代码**：`createAgent({ model: "openai:gpt-5-mini" })` + weather tool，route.ts 完全没用。要么删要么接进 RAG 当 agentic 路径
2. **`lib/pinecone.ts` 跟 route.ts 对不上**：helper 写 `bmw-qa` / `bmw_qa`，route 实际是 `bmw-datas` / `bimmerpost`。两套并存
3. **`langsmith` 没在 package.json deps**：route.ts `import { traceable } from "langsmith/traceable"` 靠 LangChain 拉进来。能跑但脆，应显式加
4. **AI SDK v5 装了没用**：`ai@5.0.98` 在 deps 但前端是手写 fetch + decoder。要么切 `useChat` + `streamText`，要么删 dep
5. **TS `any` 散在 RAG 路径**：`SearchFields[key:string]: any`、map callback `m: any` 等
6. **没 typecheck script**：`package.json` 只有 `dev/build/start/lint`
7. **README 是 create-next-app 默认**：没项目实际描述
8. **`node_modules` 没装**：第一次 `npm install` 还没跑过

## Git

- Remote: `git@github.com:real-stanyan/bimmerllm.git`
- HEAD: `95b0fe3 first commit`（之前两条：`f5e5cbd bimmerllm v0.1` / `c56cc11 Initial commit from Create Next App`）
- main 跟 origin/main 同步
