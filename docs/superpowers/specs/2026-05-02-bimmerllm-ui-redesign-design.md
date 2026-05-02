# bimmerllm UI Redesign — Design Spec

**Date**: 2026-05-02
**Status**: Approved (brainstorm)
**Reference mockup**: `/Users/stanyan/Downloads/bimmerllm/` (HTML + React UMD + Babel-standalone, complete visual prototype)

## Goals

- Port the mockup design into the live Next.js project at `~/Github/bimmerllm` without altering RAG semantics (reformulate → retrieve → generate).
- Switch streaming protocol to AI SDK v5 so retrieval sources can be transmitted as proper message annotations.
- Build three pages — Chat / Library / Settings (Preferences + Appearance only) — sharing a 268px sidebar.
- Extend the `Conversation` schema with `pinned/favorite/model` fields. Migrate existing localStorage data forward without bumping the storage key.
- Make Theme + Accent switches in Appearance instantly take effect via CSS custom properties + `data-*` attributes, persisted to localStorage, with no FOUC on hydration.

## Non-goals

- Garage / Profile / Billing / Data Settings sections (mockup includes them; V1 does not).
- User accounts / auth / login (mockup hard-codes "Adrian Karlsson"; V1 stays nameless and shows "Guest").
- Vehicle context as a Pinecone retrieval metadata filter (V1 only injects it into the prompt; retrieval namespace stays `bmw-datas/bimmerpost`).
- Multimodal input (composer drops the 📎 attach and 🎤 mic buttons present in the mockup).
- Thumbs-up/down backend endpoint (V1 stores feedback in localStorage only).
- Pinecone ingest pipeline changes (data already lives in `bmw-datas/bimmerpost` namespace; not touched).
- Resolving the existing `@langchain/community` ↔ `@langchain/core@^1.0.0-alpha.7` peer-dep conflict (continues to require `npm install --legacy-peer-deps`; tracked separately).
- Pixel-perfect mobile breakpoints. Desktop-first; <768px gets a sheet drawer for the sidebar but UI is not deeply polished.

## Architecture overview

The current app is a single-page Next.js 16 chat UI backed by a custom RAG handler:

- `app/api/chat/route.ts` — LangChain Gemini (reformulate) → Pinecone `searchRecords` → LangChain Gemini (generate) streamed via raw `TransformStream` as `text/plain`. `traceable` wraps the whole handler for LangSmith.
- `app/page.tsx` — single-page chat with a manual `fetch + reader.read()` loop appending chunks into the trailing assistant message.
- `components/chat-provider.tsx` — localStorage-backed multi-conversation state (`bimmerllm_conversations_v1`).
- `components/app-sidebar.tsx` — shadcn Sidebar listing conversations + New chat.
- `lib/agent.ts`, `lib/pinecone.ts`, `hooks/use-mobile.ts` — dead or unused helpers.

The redesign keeps the RAG **logic** but rebuilds the UI shell around real Next.js routing (`/`, `/library`, `/settings`), promotes Conversation state to a richer schema, and switches the streaming wire protocol to AI SDK v5 so a sources annotation can ride alongside the assistant text.

```
Browser
 │
 ├── Sidebar (always)              — Brand · Nav · New · Search · Threads · Footer
 │
 ├── /            ChatPage         — Topbar + Welcome|Thread + Composer
 │     useChat(api: /api/chat, body: { vehicleContext })
 │     ChatProvider hands initialMessages and persists onFinish
 │
 ├── /library     LibraryPage      — Header + Filters + List|Grid (reads ChatProvider)
 │
 └── /settings    SettingsPage     — Left nav (Preferences | Appearance)

Server (Next.js Node runtime)
 │
 └── POST /api/chat
      [step 1] LangChain ChatGoogleGenerativeAI .invoke()  — reformulate (with vehicleContext)
      [step 2] Pinecone .searchRecords()                    — topK=5 in bmw-datas/bimmerpost
      [step 3] writeMessageAnnotation({ type: "sources" })  — push hits as annotation
      [step 4] AI SDK v5 streamText({ google("gemini-2.5-flash-lite") })
      [step 5] LangSmith traceable wraps all of the above
```

## File map

### New files

- `app/(app)/layout.tsx` — Route group: Sidebar + main grid that wraps every authenticated/app-shell page.
- `app/(app)/page.tsx` — Default `/` route renders `ChatPage`.
- `app/(app)/library/page.tsx` — `LibraryPage`.
- `app/(app)/settings/page.tsx` — `SettingsPage` (Preferences + Appearance only).
- `components/sidebar/` — `Sidebar.tsx`, `Brand.tsx`, `NavItems.tsx`, `NewConsultationButton.tsx`, `SearchBox.tsx`, `ThreadList.tsx`, `ThreadGroup.tsx`, `ThreadItem.tsx`, `UserFooter.tsx`.
- `components/chat/` — `ChatPage.tsx`, `Topbar.tsx`, `ModelPicker.tsx`, `Welcome.tsx`, `SuggestedPrompts.tsx`, `Thread.tsx`, `Message.tsx`, `UserBubble.tsx`, `AssistantBlock.tsx`, `SourcesPanel.tsx`, `ActionsBar.tsx`, `ThinkingDots.tsx`, `Composer.tsx`.
- `components/library/` — `LibraryPage.tsx`, `LibraryHeader.tsx`, `LibraryFilters.tsx`, `ListView.tsx`, `ListRow.tsx`, `GridView.tsx`, `GridCard.tsx`.
- `components/settings/` — `SettingsPage.tsx`, `SettingsNav.tsx`, `PreferencesSection.tsx`, `AppearanceSection.tsx`, `Toggle.tsx`, `Segment.tsx`, `ThemeSwatch.tsx`, `AccentSwatch.tsx`.
- `components/ui/icons.tsx` — Stroke-style icon set ported from the mockup. Lean on `lucide-react` for matches; only port custom paths the mockup invents.
- `lib/conversation.ts` — `Conversation` / `Message` / `SourceCitation` types + `migrateConversation()` + `getBucket()` + `derivePreview()`.
- `lib/theme.ts` — Theme + Accent enums and constants; `applyTheme()` / `applyAccent()` mutate `document.documentElement.dataset` and write localStorage.
- `lib/sources.ts` — `SourceCitation` type + small parser for annotation payloads.
- `lib/ai/google.ts` — `@ai-sdk/google` provider singleton (centralizes API key reading).

### Rewritten files

- `app/api/chat/route.ts` — Hybrid LangChain (reformulate + retrieve) + AI SDK v5 (`streamText`) generation; emits `writeMessageAnnotation({ type: "sources" })` for the Pinecone hits before generation begins.

### Modified files

- `app/layout.tsx` — Stops rendering the sidebar (deferred to `(app)/layout.tsx`); adds `Geist_Mono` via `next/font/google`; injects an inline pre-hydration script that reads `bimmerllm_theme` / `bimmerllm_accent` from localStorage and sets `data-theme` / `data-accent` on `<html>`.
- `app/globals.css` — Adopts the mockup's design tokens (`:root` block of `bg-/text-/line-/accent-/radii/shadows/spacing`, all `oklch` accents), the `body::before` ambient gradient, the `.prose` markdown helpers, and the keyframes (`fadeUp`, `fadeIn`, `pulseSoft`, `shimmer`, `spin`); remaps shadcn defaults (`--background`, `--foreground`, `--card`, `--primary`, etc.) to point at the new token set; declares per-`data-theme` and per-`data-accent` overrides for static apply.
- `components/chat-provider.tsx` — `Conversation` schema gains `pinned/favorite/model`; on read it migrates legacy entries (defaults: `pinned=false`, `favorite=false`, `model="Auto-detect"`); exposes `togglePinned(id)`, `toggleFavorite(id)`, `setModel(id, model)`. The provider continues to own multi-conversation state and persistence; per-active-conversation message streaming is delegated to `useChat`. The provider exports a `roleMap` boundary helper that maps `"model" ↔ "assistant"` so storage stays on `"model"` while AI SDK sees `"assistant"`.
- `package.json` — Adds `@ai-sdk/google`; promotes `langsmith` from transitive to explicit dependency; removes `@langchain/openai` and `langchain` (only the `core` / `community` / `google-genai` / `ollama` packages stay); adds `"typecheck": "tsc --noEmit"` script.

### Deleted files

- `lib/agent.ts` — Dead code (createAgent + weather tool, unused).
- `lib/pinecone.ts` — Dead helper that points at the wrong index/namespace (`bmw-qa/bmw_qa` vs the live `bmw-datas/bimmerpost`). Pinecone client moves into the route handler or `lib/ai/pinecone.ts`.
- `components/app-sidebar.tsx` — Replaced by `components/sidebar/`.
- `app/page.tsx` — Replaced by `app/(app)/page.tsx` rendering `ChatPage`.
- `hooks/use-mobile.ts` — Delete only if no surviving consumer (verify during implementation; likely orphaned after sidebar swap).

## Routing

Next.js App Router with one route group `(app)`:

```
/             → ChatPage
/library      → LibraryPage
/settings     → SettingsPage
/api/chat     → POST handler
```

Sidebar nav uses `next/link` + `usePathname()` to highlight the active nav item. The route group keeps the sidebar component in `(app)/layout.tsx` so all three pages share the same shell without remounting it.

## Backend / route handler design

### Request contract

```ts
POST /api/chat
Content-Type: application/json
Body: {
  messages: UIMessage[]      // AI SDK v5 UIMessage shape
  vehicleContext?: string    // "Auto-detect" | "335i • E92" | ...; default "Auto-detect"
}
```

### 5-step pipeline

1. **Reformulate** — `ChatGoogleGenerativeAI("gemini-2.5-flash-lite").invoke()`. With history, rephrase to a standalone English search query that incorporates `vehicleContext`. Without history, translate the current question and prepend the vehicle context. On error, fall back to the raw current question as the search input.

2. **Retrieve** — `pc.index("bmw-datas").namespace("bimmerpost").searchRecords({ query: { topK: 5, inputs: { text: searchInput } }, fields: ["answers"] })`. On error, log and proceed to generation with empty context plus a note in the system prompt.

3. **Sources annotation** — Map hits to `SourceCitation[]` (`{ id: hit._id, score: hit._score, preview: hit.fields.answers.slice(0, 240) }`) and emit via `writeMessageAnnotation({ type: "sources", sources })` before `streamText` begins. (Implementation note: if AI SDK v5 requires the annotation to be emitted *during* the streaming write phase rather than before, fall back to emitting it inside the `onChunk` callback at the first text chunk, or via `onFinish`. Implementer should verify behavior empirically and pick the earliest-firing path.)

4. **Generate** — `streamText({ model: google("gemini-2.5-flash-lite"), system, messages, temperature: 0.2 })` returned via `.toUIMessageStreamResponse({ sendSources: true })`.

   System prompt skeleton:
   ```
   你是一个专业的 BMW 技术顾问。
   用户车辆背景: ${vehicleContext === 'Auto-detect' ? '用户未指定具体车型' : vehicleContext}
   请基于下方参考资料回答。无历史就回答；有历史结合上下文。
   优先依据参考资料；资料里没有的内容明确说"参考资料中未涉及"。
   用户车辆相关的部分要针对那个车型给具体建议。

   参考资料:
   ${contextText}
   ```

5. **LangSmith trace** — Wrap the whole handler with `traceable({ name: "bmw-rag-route" })`. Wrap each step with sub-traceable for granular spans (`reformulate`, `retrieve`, `generate`).

### Wire-format example

```jsonl
{"type":"text-start","id":"m1"}
{"type":"message-annotation","data":{"type":"sources","sources":[
  {"id":"abc123","score":0.87,"preview":"E90 N54 cold start hesitation often..."},
  {"id":"def456","score":0.84,"preview":"HPFP failure mode: pressure drops..."}
]}}
{"type":"text-delta","id":"m1","delta":"涡轮增压"}
{"type":"text-delta","id":"m1","delta":"相关..."}
{"type":"text-end","id":"m1"}
{"type":"finish"}
```

The client reads `message.annotations[]` and looks for the first entry where `type === "sources"`.

### Error handling

- Pinecone failure → context becomes `"参考资料库暂时无法访问。"`, generation continues.
- Reformulate failure → `searchInput = currentQuestion` (no English translation).
- Generate failure → `useChat` `error` state surfaces in the UI; ActionsBar shows a Retry button which calls `regenerate()`.
- `vehicleContext` empty / malformed → coerced to `"Auto-detect"`.

## Data model

### Types (`lib/conversation.ts`)

```ts
export type StorageRole = "user" | "model"   // legacy storage shape

export interface SourceCitation {
  id: string
  score: number
  preview: string
}

export interface Message {
  role: StorageRole
  content: string
  // Optional, only on model messages, only on new entries
  sources?: SourceCitation[]
  thumbsUp?: boolean
  thumbsDown?: boolean
  latencyMs?: number
  tokenCount?: number  // estimated (chars/4)
}

export interface Conversation {
  id: string
  title: string
  messages: Message[]
  createdAt: string
  updatedAt: string
  pinned?: boolean      // V1 default false
  favorite?: boolean    // V1 default false
  model?: string        // V1 default "Auto-detect"
}

export type Bucket = "today" | "yesterday" | "week" | "older"

export function migrateConversation(raw: unknown): Conversation { ... }
export function getBucket(updatedAt: string, now?: Date): Bucket { ... }
export function derivePreview(messages: Message[]): string { ... }  // first user msg, 80 char trim
```

### Role mapping at the useChat boundary

Storage uses `"user" | "model"`; AI SDK v5 uses `"user" | "assistant"`. To avoid migrating all existing localStorage data, the boundary in `ChatPage.tsx` and `ChatProvider`:

- **Read** (storage → useChat `initialMessages`): `m => ({ ...m, role: m.role === "model" ? "assistant" : "user" })`
- **Write** (useChat onFinish → storage): `m => ({ ...m, role: m.role === "assistant" ? "model" : "user" })`

This keeps storage stable and avoids a one-time migration churn.

### Switching active conversation

`<ChatPage key={activeConversation.id} />` forces the entire page to remount when the user picks a different thread. This sidesteps `useChat`'s no-mid-stream `initialMessages` change and is acceptable visually because the `animate-fadeIn` (0.25s) on the page wrapper smooths the swap.

### LocalStorage keys

| Key | Type | Default | Notes |
|---|---|---|---|
| `bimmerllm_conversations_v1` | `Conversation[]` | `[]` | Existing key; migrated forward in place, not bumped. |
| `bimmerllm_theme` | `"midnight" \| "graphite" \| "abyss"` | `"midnight"` | Read by inline script before hydration; mirrored to `<html data-theme=...>`. |
| `bimmerllm_accent` | `"blue" \| "ice" \| "violet" \| "ember" \| "forest"` | `"blue"` | Same. |
| `bimmerllm_prefs` | `{ units, citations, autoModel }` | `{ "metric", true, true }` | Preferences page. |

## Theme / Accent system

CSS variables drive everything visual. Static rules in `globals.css` map `data-theme` / `data-accent` to overrides:

```css
:root[data-theme="graphite"] {
  --bg-0: #0F0F0F;
  --bg-1: #1A1A1A;
  --bg-2: #1F1F1F;
  --bg-3: #252525;
  --bg-4: #2D2D2D;
}
:root[data-theme="abyss"] {
  --bg-0: #000004;
  --bg-1: #050510;
  --bg-2: #0A0A18;
  --bg-3: #11112A;
  --bg-4: #18183A;
}
:root[data-accent="ice"]    { --accent: oklch(0.78 0.10 220); --accent-hi: oklch(0.86 0.08 220); --accent-lo: oklch(0.55 0.10 220); --accent-soft: oklch(0.78 0.10 220 / 0.10); --accent-glow: oklch(0.78 0.10 220 / 0.18); }
:root[data-accent="violet"] { --accent: oklch(0.65 0.18 285); --accent-hi: oklch(0.74 0.16 285); ... }
:root[data-accent="ember"]  { --accent: oklch(0.68 0.18 35);  ... }
:root[data-accent="forest"] { --accent: oklch(0.65 0.13 155); ... }
```

`applyTheme(t)` and `applyAccent(a)` only set `document.documentElement.dataset.theme = t` (and storage). No JS-driven `setProperty` calls means swatches flip instantly and there's no possibility of a mismatch between live state and hydrated state.

The pre-hydration inline script in `<head>` reads localStorage and sets the same `dataset` attributes before any CSS resolves → 0 FOUC.

## Components — visual system

### Tokens (mockup → globals.css)

The mockup's `styles.css` `:root` block is adopted verbatim with these adjustments:

- All `--bg-*` / `--text-*` / `--line-*` / `--accent*` retained as-is in `oklch`.
- `--font-sans` → set by Next.js `next/font/google` `Geist` (already present); CSS var name renamed to `--font-geist-sans` to match Next convention.
- `--font-mono` → new; `next/font/google` `Geist_Mono` registered as `--font-geist-mono`.
- Spacing / radii / shadows verbatim.

### shadcn retheme map

```css
:root {
  --background: var(--bg-1);
  --foreground: var(--text-1);
  --card: var(--bg-3);
  --card-foreground: var(--text-1);
  --popover: var(--bg-elev);
  --popover-foreground: var(--text-1);
  --primary: var(--accent);
  --primary-foreground: #0A0A0F;
  --muted: var(--bg-3);
  --muted-foreground: var(--text-3);
  --accent: var(--accent-soft);
  --accent-foreground: var(--accent-hi);
  --destructive: var(--red);
  --border: var(--line-2);
  --input: var(--line-2);
  --ring: var(--accent);
  --radius: 0.5rem;
}
```

### Inline-style retention list

Tailwind covers padding/margin/gap/grid/flex/rounded/border/text-color/transitions. Inline `style={{}}` is reserved for:

- `body::before` ambient radial gradient (lives in `globals.css` directly).
- Sidebar `Brand` logo gradient square + box-shadow (`linear-gradient(135deg, oklch(0.45 0.13 245), oklch(0.30 0.10 250))` + glow).
- `AssistantBlock` model mark (same gradient + glow).
- `AccentSwatch` round buttons (each carries its own oklch swatch).
- `Composer` pill double shadow (`0 8px 24px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.04)`).

### Typography spot mappings

| Mockup px | Tailwind |
|---|---|
| 32 (welcome) | `text-[32px]` |
| 28 (page h1) | `text-[28px]` |
| 18 (section h2) | `text-lg` |
| 16 (card title) | `text-base` |
| 14 (body) | `text-sm` |
| 13.5 (thread title) | `text-[13.5px]` |
| 12.5 (small body) | `text-[12.5px]` |
| 12 (meta) | `text-xs` |
| 11 / 10.5 (kicker mono) | `text-[11px]` / `text-[10.5px]` |

Letter-spacing: body `-0.005em` set globally; titles use Tailwind `tracking-tight`.

## Component behaviors

### Sidebar

- 268px fixed width on `≥768px`; on `<768px` collapses behind a sheet trigger in the topbar (uses shadcn `Sheet`).
- `SearchBox`: filters threads on title or model substring (case-insensitive).
- `ThreadList`: groups by `pinned` (own bucket on top), then `getBucket(updatedAt)` → Today / Yesterday / Past 7 days / Older. Empty groups suppressed.
- `ThreadItem`: shows favorite star icon when `c.favorite`. Click navigates `router.push("/")` and `setActiveId(c.id)`.
- `NewConsultationButton`: ⌘N keyboard shortcut bound globally (window keydown). New conv defaults to `model: "Auto-detect"`, `pinned: false`, `favorite: false`.
- `UserFooter`: shows "Guest" + neutral avatar; click goes to `/settings`.

### ChatPage

- Uses `key={activeConversation.id}` to force remount on conversation switch.
- `useChat({ api: "/api/chat", initialMessages, body: { vehicleContext } })`.
- `vehicleContext` state mirrors `activeConversation.model` and updates the conversation when changed via ModelPicker.
- `onFinish`: persists the new assistant message back into ChatProvider (with role mapping `assistant → model`), updates `latencyMs` (now - `streamStartedAt`) and `tokenCount` (assistant content length / 4), and reads `annotations` for sources.
- Empty state: renders `Welcome`. Non-empty: renders `Thread`.

### Welcome

- Greeting: `What are we troubleshooting today?` (no time-based prefix, no name).
- Subtitle: `A senior-level consultant for BMW ownership — diagnostics, coding, modifications, and buying advice. Trained on bimmerpost forum knowledge.`
- 4 suggested-prompts cards (Diagnose / Compare / Tune / Service interval) — clicking inserts the body as the next user message.
- "Quick context" model chip row from the mockup is **dropped** (redundant with Topbar ModelPicker).

### Thread + Message

- User message: right-aligned bubble (`bg-3 + line-2 border + 14px 14px 4px 14px` corners), 78% max-width (`min(720px, 78%)`), no avatar.
- Assistant message: left-aligned, gradient model mark on the left, label "bimmerllm · N sources cited" above the bubble (N from annotation), prose body uses `.prose` class; below: ActionsBar + `latencyMs · tokenCount` mono meter.
- `ThinkingDots`: rendered when streaming has begun but no text yet. Three pulsing dots + "Retrieving from bimmerpost, consulting…".
- Sources panel: rendered as a clickable summary `▸ N sources cited`. Clicking expands a `<details>`-style panel listing each `SourceCitation` with score (mono, 2-decimal) + preview (first 240 chars of the answer text). No outbound link in V1 (data lacks URL field).

### ActionsBar

- Copy: `navigator.clipboard.writeText(message.content)` + transient toast.
- Regenerate: calls `regenerate()` from `useChat`. Replaces the trailing assistant message.
- Thumbs-up / Thumbs-down: toggle `message.thumbsUp` / `thumbsDown` in ChatProvider, persists to localStorage. No backend call.
- Latency / token: read from `message.latencyMs` / `message.tokenCount`; displayed as `0.9s · 412 tok` in mono.

### Composer

- Single-line `input` (matches mockup; multiline can be a future improvement).
- Round send button. While streaming: button morphs into a stop button calling `useChat`'s `stop()`.
- No 📎, no 🎤 (V1 dropped).
- Disclaimer below: `bimmerllm references bimmerpost community knowledge. Always verify critical procedures with your service manual.`

### Topbar

- Breadcrumb: `Consultation › <conversation title or "New session">`.
- ModelPicker: dropdown of `["Auto-detect", "335i • E92", "M3 • F80", "M340i • G20", "M5 • F90", "X5 • G05"]` (constants for V1; later configurable). Changing it: `setVehicleContext(value)` and `togglePinned`-style update on the active conversation's `model` field (via ChatProvider) so it persists.
- Bookmark button: toggles `pinned` on the active conversation.
- Refresh button: triggers `regenerate()` on the trailing assistant message (if any). Disabled when there is no assistant message.

### LibraryPage

- Header: kicker `LIBRARY`, h1 `Consultation history`, subtitle `<n> sessions · <m> favorited`, search box (240px), list/grid view toggle.
- Filter pills: All / Favorites / Pinned / Today (each shows count). Sort: Most recent | A → Z.
- List view: rows with mark icon (`Pin` / `Star` / `Chat`), title, preview (`derivePreview(c.messages)`), mono model tag, relative time, chevron. Click → `setActiveId(c.id)` + `router.push("/")`.
- Grid view: cards (280px min-width auto-fill); same data; line-clamp 3 on preview.

### SettingsPage

- Two sections (Preferences, Appearance), left sticky 200px nav.
- **Preferences**: rows of `Toggle` / `Segment`:
  - Measurement units — `metric | imperial` (Segment).
  - Cite sources inline — `Toggle` (controls whether SourcesPanel renders below assistant messages).
  - Auto-detect vehicle — `Toggle` (cosmetic in V1; planned to influence ModelPicker default behavior).
  - All three persist to `bimmerllm_prefs` localStorage.
- **Appearance**:
  - 3 theme swatches (Midnight / Graphite / Abyss) — gradient previews. Click → `applyTheme(id)`.
  - 5 accent swatches (blue / ice / violet / ember / forest) — `applyAccent(id)`.
  - Both flip instantly via CSS `data-attribute` overrides.

## Migration

- ChatProvider runs `migrateConversation()` on every entry read from `bimmerllm_conversations_v1`. Defaults populated for `pinned` / `favorite` / `model` (first two false, model `"Auto-detect"`). Older `Message` entries gain no new fields; `sources` / thumbs / latency / token render conditionally.
- Storage is **never bumped**. Re-saving (which happens after any update) naturally writes the new fields, but old clients reading newer data simply ignore unknown keys (objects are accessed by named field, not strict shape).
- New `bimmerllm_theme` / `bimmerllm_accent` / `bimmerllm_prefs` keys default to `null`; theme/accent default to `midnight` / `blue`; prefs default to metric / true / true.
- The pre-hydration inline script handles the FOUC window: it reads only `bimmerllm_theme` and `bimmerllm_accent` and sets `document.documentElement.dataset.theme/accent` before React hydrates, so first paint already has the right CSS variables.

## Testing

Vitest unit tests for pure logic only (no React renders in V1):

- `lib/conversation.test.ts` — 6 cases for `migrateConversation` (4 missing-field flavors + 2 complete inputs); `getBucket` 4 boundary cases (today / yesterday / past 7 / older); `derivePreview` 2 cases (long content trim + empty).
- `lib/sources.test.ts` — annotation parser: happy path + malformed JSON returns `null`.

Manual verification via `cmux browser`:

- `/` happy path: Welcome → click suggested prompt → `useChat` posts → ThinkingDots → text streams → SourcesPanel populates → ActionsBar shows latency + token.
- `/library` filter pills + search + list/grid toggle.
- `/settings` Theme + Accent live-flip; Preferences toggles persist after reload.
- Sidebar: New chat (⌘N), search filter, click thread to switch, page swap animates without flicker.
- Mobile: viewport set to 375px; sheet drawer opens, content readable.

`npm run typecheck` (newly added) + `npm run lint` should both stay green throughout.

## Implementation order (rough)

The detailed step-by-step plan is produced separately by the writing-plans skill. High level:

1. Tokens & shell (globals.css design tokens + retheme map + Geist Mono font + `(app)` route group + theme init script).
2. Sidebar (full visual + ChatProvider extension for pinned/favorite/model + migration helpers).
3. Backend rewrite (route.ts AI SDK v5 + LangChain hybrid + sources annotation + vehicleContext).
4. ChatPage (Welcome + Thread + Message + ActionsBar + Composer + ModelPicker + SourcesPanel + ThinkingDots).
5. Library page.
6. Settings page (Preferences + Appearance) + theme/accent live-flip.
7. Cleanup (delete `lib/agent.ts`, `lib/pinecone.ts`, conditionally `hooks/use-mobile.ts`, drop `langchain` + `@langchain/openai` from deps, add `@ai-sdk/google` + promote `langsmith`, add `typecheck` script).
8. End-to-end manual verification via `cmux browser`.

## Risks + mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Pinecone hits do not include source URLs (only `answers` text) | "N sources cited" cannot link to forum threads; only score + preview shown | Accepted: V1 displays score + preview only; future ingest can add URL metadata. |
| AI SDK v5 `writeMessageAnnotation` may not flush before the first text chunk | Sources may arrive after text begins streaming | Implementer to verify timing. Fallbacks (in order of preference): emit during the first text chunk via `onChunk`, or in `onFinish`. The UI must tolerate annotations arriving after text. |
| Vehicle context injection may degrade reformulate quality if retrieval namespace ignores model context | Lower hit relevance | No A/B in V1; subjective check during smoke. If degraded, the implementer can de-emphasize the vehicle hint in the reformulate prompt and only keep it in the final prompt. |
| `useChat` re-mount via `key={id}` causes a visual blink on conversation switch | UX flicker | Wrap the page in `animate-fadeIn` 0.25s. Mockup behavior is identical (full re-render). |
| Storage uses `role: "model"`, AI SDK v5 wants `"assistant"` | Mismatched messages crash `useChat` or render incorrectly | Map at the boundary (read: `model→assistant`; write: `assistant→model`). Storage shape never changes. |
| shadcn `Sheet` / `Tooltip` / `Skeleton` may have hard-coded colors that break under retheme | Visual regressions in modals/tooltips | Verify each shadcn primitive used (`Button`, `Input`, `Sheet`, `Sidebar`, `Tooltip`, `Skeleton`, `Separator`) under the new tokens; patch overrides as needed. |
| `@langchain/community` requires `@langchain/core@^1.0.0` (stable), repo pins `^1.0.0-alpha.7` | `npm install` continues to need `--legacy-peer-deps` | Out of scope for this spec; tracked as a separate task in DEV_QUEUE. |
| Mockup's `Bookmark` and `Refresh` topbar buttons have ambiguous semantics | Risk of building wrong feature | Spec defines: Bookmark = `togglePinned(activeId)`, Refresh = `regenerate()` (disabled when no assistant message). |

## Out of scope (final list)

- Garage / Profile / Billing / Data Settings sections.
- User account / auth / login.
- Vehicle context affecting Pinecone retrieval (metadata filter).
- Multimodal (`📎` attach / `🎤` voice).
- Thumbs feedback backend endpoint.
- Pinecone ingest pipeline changes.
- Resolving the `langchain` peer-dep conflict.
- Deep mobile responsive polish (drawer works; finer breakpoints not tuned).
