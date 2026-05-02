# bimmerllm UI Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port the mockup at `/Users/stanyan/Downloads/bimmerllm/` into the live Next.js project, wire AI SDK v5 streaming with sources annotations, extend Conversation schema with pinned/favorite/model, and build Chat + Library + Settings(Preferences + Appearance) pages.

**Architecture:** Next.js 16 App Router with `(app)` route group sharing a 268px sidebar. RAG hybrid: LangChain Gemini for reformulate, Pinecone for retrieve, AI SDK v5 `streamText` for generation. Sources transmitted via `writeMessageAnnotation`. Theme/accent via CSS variables + `data-*` attributes + pre-hydration script.

**Tech Stack:** Next.js 16 + React 19 + Tailwind v4 + shadcn (new-york/neutral) + AI SDK v5 (`@ai-sdk/google`) + LangChain `@langchain/google-genai` + Pinecone v6 + Vitest + LangSmith trace.

**Reference spec:** `~/Github/bimmerllm/docs/superpowers/specs/2026-05-02-bimmerllm-ui-redesign-design.md` (commit `cc902ec`).

**Reference mockup:** `/Users/stanyan/Downloads/bimmerllm/` (HTML + React UMD + Babel-standalone). When tasks say "port mockup X", the visual source of truth lives there.

---

## File map summary

```
app/
  layout.tsx                                MODIFY (Geist Mono + theme init script + drop sidebar)
  globals.css                               MODIFY (design tokens + body::before + retheme map + .prose + keyframes)
  page.tsx                                  DELETE
  (app)/
    layout.tsx                              CREATE (Sidebar + main grid)
    page.tsx                                CREATE (renders ChatPage)
    library/page.tsx                        CREATE
    settings/page.tsx                       CREATE
  api/chat/route.ts                         REWRITE (AI SDK v5 + LangChain hybrid + sources annotation)

components/
  app-sidebar.tsx                           DELETE
  chat-provider.tsx                         MODIFY (extend schema + role map + togglePinned/Favorite/setModel)
  sidebar/                                  CREATE
    Brand.tsx, NavItems.tsx, NewConsultationButton.tsx, SearchBox.tsx,
    ThreadGroup.tsx, ThreadItem.tsx, ThreadList.tsx, UserFooter.tsx, Sidebar.tsx
  chat/                                     CREATE
    Composer.tsx, ModelPicker.tsx, Topbar.tsx, Welcome.tsx, ThinkingDots.tsx,
    SourcesPanel.tsx, ActionsBar.tsx, AssistantBlock.tsx, UserBubble.tsx,
    Message.tsx, Thread.tsx, ChatPage.tsx
  library/                                  CREATE
    LibraryHeader.tsx, LibraryFilters.tsx, ListRow.tsx, ListView.tsx,
    GridCard.tsx, GridView.tsx, LibraryPage.tsx
  settings/                                 CREATE
    Toggle.tsx, Segment.tsx, ThemeSwatch.tsx, AccentSwatch.tsx,
    PreferencesSection.tsx, AppearanceSection.tsx, SettingsNav.tsx, SettingsPage.tsx
  ui/
    icons.tsx                               CREATE (mockup-specific stroke icons)

hooks/use-mobile.ts                          DELETE (verify no consumer first)

lib/
  agent.ts                                  DELETE
  pinecone.ts                               DELETE (replaced by lib/ai/pinecone.ts)
  utils.ts                                  KEEP
  conversation.ts                           CREATE (types + migrateConversation + getBucket + derivePreview)
  theme.ts                                  CREATE (THEMES + ACCENTS + applyTheme + applyAccent)
  sources.ts                                CREATE (parser + types)
  ai/google.ts                              CREATE (@ai-sdk/google singleton)
  ai/pinecone.ts                            CREATE (Pinecone singleton)

package.json                                MODIFY (+ @ai-sdk/google + langsmith explicit + typecheck script; - langchain - @langchain/openai)
```

---

## Phase 1 — Foundation: Tokens, Fonts, Route group

### Task 1.1: Add Geist Mono font to root layout

**Files:**
- Modify: `app/layout.tsx`

- [ ] **Step 1: Replace `app/layout.tsx`**

```tsx
// app/layout.tsx
import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { ChatProvider } from "@/components/chat-provider";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

const themeInitScript = `
  try {
    const t = localStorage.getItem("bimmerllm_theme");
    const a = localStorage.getItem("bimmerllm_accent");
    if (t) document.documentElement.dataset.theme = t;
    if (a) document.documentElement.dataset.accent = a;
  } catch {}
`;

export const metadata: Metadata = {
  title: "bimmerllm",
  description: "BMW knowledge consultant powered by bimmerpost forum data.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable}`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className="min-h-screen antialiased">
        <ChatProvider>{children}</ChatProvider>
      </body>
    </html>
  );
}
```

- [ ] **Step 2: Verify dev server still starts**

Run: `npm run dev` (in background)
Expected: `✓ Ready in <ms>`. Open http://localhost:3000 and confirm no hydration error in browser console (cmux browser console list).

- [ ] **Step 3: Commit**

```bash
git add app/layout.tsx
git commit -m "feat(layout): add Geist Mono + theme init script + drop sidebar from root"
```

---

### Task 1.2: Port design tokens into globals.css

**Files:**
- Modify: `app/globals.css`

- [ ] **Step 1: Replace `app/globals.css`** (port from `/Users/stanyan/Downloads/bimmerllm/styles.css` + adjust for shadcn retheme + per-theme/accent overrides)

```css
@import "tailwindcss";
@import "tw-animate-css";

@custom-variant dark (&:is(.dark *));

/* ============================================
   bimmerllm — design tokens
   ============================================ */
:root {
  /* Surfaces */
  --bg-0: #08080B;
  --bg-1: #0E0E12;
  --bg-2: #15151B;
  --bg-3: #1B1B22;
  --bg-4: #22222B;
  --bg-elev: #1E1E26;

  /* Hairlines */
  --line-1: rgba(255, 255, 255, 0.06);
  --line-2: rgba(255, 255, 255, 0.09);
  --line-3: rgba(255, 255, 255, 0.14);

  /* Text */
  --text-1: #F4F5F7;
  --text-2: #C9CAD0;
  --text-3: #8A8B93;
  --text-4: #5C5D66;

  /* Accent — refined blue (default) */
  --accent: oklch(0.68 0.16 245);
  --accent-hi: oklch(0.78 0.14 245);
  --accent-lo: oklch(0.45 0.13 245);
  --accent-glow: oklch(0.68 0.16 245 / 0.18);
  --accent-soft: oklch(0.68 0.16 245 / 0.10);

  /* Status */
  --green: oklch(0.72 0.15 155);
  --amber: oklch(0.78 0.14 75);
  --red:   oklch(0.68 0.20 25);

  /* Type */
  --font-sans: var(--font-geist-sans), -apple-system, BlinkMacSystemFont, system-ui, sans-serif;
  --font-mono: var(--font-geist-mono), "SF Mono", ui-monospace, monospace;

  /* Radii */
  --r-xs: 6px;
  --r-sm: 8px;
  --r-md: 12px;
  --r-lg: 16px;
  --r-xl: 22px;
  --r-pill: 999px;

  /* Shadows */
  --shadow-sm: 0 1px 2px rgba(0,0,0,0.30);
  --shadow-md: 0 8px 24px rgba(0,0,0,0.35), 0 1px 0 rgba(255,255,255,0.04) inset;
  --shadow-lg: 0 24px 60px rgba(0,0,0,0.55), 0 1px 0 rgba(255,255,255,0.05) inset;
  --shadow-glow: 0 0 0 1px var(--accent-soft), 0 12px 32px var(--accent-glow);

  /* Spacing */
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-5: 20px;
  --space-6: 24px;
  --space-8: 32px;
  --space-10: 40px;
  --space-12: 56px;
  --space-16: 80px;

  /* shadcn retheme map */
  --background: var(--bg-1);
  --foreground: var(--text-1);
  --card: var(--bg-3);
  --card-foreground: var(--text-1);
  --popover: var(--bg-elev);
  --popover-foreground: var(--text-1);
  --primary: var(--accent);
  --primary-foreground: #0A0A0F;
  --secondary: var(--bg-3);
  --secondary-foreground: var(--text-1);
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

/* Per-theme overrides */
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

/* Per-accent overrides */
:root[data-accent="ice"]    { --accent: oklch(0.78 0.10 220); --accent-hi: oklch(0.86 0.08 220); --accent-lo: oklch(0.55 0.10 220); --accent-soft: oklch(0.78 0.10 220 / 0.10); --accent-glow: oklch(0.78 0.10 220 / 0.18); }
:root[data-accent="violet"] { --accent: oklch(0.65 0.18 285); --accent-hi: oklch(0.74 0.16 285); --accent-lo: oklch(0.45 0.15 285); --accent-soft: oklch(0.65 0.18 285 / 0.10); --accent-glow: oklch(0.65 0.18 285 / 0.18); }
:root[data-accent="ember"]  { --accent: oklch(0.68 0.18 35);  --accent-hi: oklch(0.78 0.16 35);  --accent-lo: oklch(0.50 0.16 35);  --accent-soft: oklch(0.68 0.18 35 / 0.10);  --accent-glow: oklch(0.68 0.18 35 / 0.18); }
:root[data-accent="forest"] { --accent: oklch(0.65 0.13 155); --accent-hi: oklch(0.74 0.12 155); --accent-lo: oklch(0.45 0.12 155); --accent-soft: oklch(0.65 0.13 155 / 0.10); --accent-glow: oklch(0.65 0.13 155 / 0.18); }

* { box-sizing: border-box; }

html, body {
  margin: 0;
  padding: 0;
  height: 100%;
  width: 100%;
  background: var(--bg-1);
  color: var(--text-1);
  font-family: var(--font-sans);
  font-size: 14px;
  line-height: 1.5;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  text-rendering: optimizeLegibility;
  letter-spacing: -0.005em;
}

body::before {
  content: "";
  position: fixed;
  inset: 0;
  background:
    radial-gradient(1200px 600px at 75% -10%, oklch(0.45 0.14 245 / 0.15), transparent 60%),
    radial-gradient(900px 500px at 10% 110%, oklch(0.40 0.10 250 / 0.10), transparent 60%);
  pointer-events: none;
  z-index: 0;
}

#__next, body > div { position: relative; z-index: 1; }

::-webkit-scrollbar { width: 10px; height: 10px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb {
  background: rgba(255,255,255,0.08);
  border-radius: 999px;
  border: 2px solid transparent;
  background-clip: padding-box;
}
::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.16); background-clip: padding-box; border: 2px solid transparent; }

::selection { background: var(--accent-soft); color: var(--text-1); }

:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
  border-radius: 4px;
}

/* Utility classes ported from mockup */
.kbd {
  font-family: var(--font-mono);
  font-size: 11px;
  padding: 2px 6px;
  border-radius: 5px;
  background: var(--bg-3);
  border: 1px solid var(--line-2);
  color: var(--text-2);
  letter-spacing: 0;
}
.no-scrollbar { scrollbar-width: none; }
.no-scrollbar::-webkit-scrollbar { display: none; }

/* Prose helpers */
.prose p { margin: 0 0 8px 0; }
.prose p:last-child { margin-bottom: 0; }
.prose ul, .prose ol { margin: 4px 0 8px; padding-left: 22px; }
.prose ul li { list-style: disc; }
.prose ol li { list-style: decimal; }
.prose li { margin: 2px 0; }
.prose code {
  font-family: var(--font-mono);
  font-size: 12.5px;
  background: rgba(255,255,255,0.08);
  padding: 1px 6px;
  border-radius: 4px;
}
.prose pre {
  background: var(--bg-1);
  border: 1px solid var(--line-2);
  padding: 12px 14px;
  border-radius: var(--r-md);
  overflow-x: auto;
  margin: 8px 0;
  font-size: 12.5px;
}
.prose strong { color: var(--text-1); font-weight: 600; }
.prose h3 { font-size: 14px; font-weight: 600; margin: 12px 0 6px; }
.prose table { width: 100%; border-collapse: collapse; margin: 8px 0; font-size: 13px; }
.prose th, .prose td { border: 1px solid var(--line-2); padding: 6px 10px; text-align: left; }
.prose th { background: var(--bg-4); font-weight: 600; font-size: 12px; letter-spacing: 0.02em; text-transform: uppercase; color: var(--text-2); }

/* Animations */
@keyframes fadeUp {
  from { opacity: 0; transform: translateY(6px); }
  to { opacity: 1; transform: translateY(0); }
}
@keyframes fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}
@keyframes pulseSoft {
  0%, 100% { opacity: 0.45; }
  50% { opacity: 1; }
}
@keyframes shimmer {
  0% { background-position: -200% 0; }
  100% { background-position: 200% 0; }
}
@keyframes spin { to { transform: rotate(360deg); } }

.animate-fadeUp { animation: fadeUp 0.35s cubic-bezier(0.2, 0.8, 0.2, 1) both; }
.animate-fadeIn { animation: fadeIn 0.25s ease both; }
```

- [ ] **Step 2: Reload browser, verify no CSS errors**

Run: `cmux browser reload` then `cmux browser console list`
Expected: No CSS parse errors. Page renders dark.

- [ ] **Step 3: Commit**

```bash
git add app/globals.css
git commit -m "feat(theme): port mockup design tokens + per-theme/accent overrides + shadcn retheme map"
```

---

### Task 1.3: Create (app) route group with placeholder layout

**Files:**
- Create: `app/(app)/layout.tsx`
- Create: `app/(app)/page.tsx`

- [ ] **Step 1: Create `app/(app)/layout.tsx`** (placeholder; real Sidebar arrives in Phase 3)

```tsx
// app/(app)/layout.tsx
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-svh w-full">
      <aside className="w-[268px] shrink-0 border-r border-[var(--line-1)] bg-[var(--bg-2)] p-4">
        <div className="text-[var(--text-3)] text-xs font-mono uppercase tracking-wider">sidebar placeholder</div>
      </aside>
      <main className="flex-1 min-w-0 flex flex-col bg-[var(--bg-1)]">
        {children}
      </main>
    </div>
  );
}
```

- [ ] **Step 2: Create `app/(app)/page.tsx`** (temporary; current page logic moved here)

Read the current `app/page.tsx` content first, then move it to `app/(app)/page.tsx` verbatim — this is purely a path move. Then delete `app/page.tsx`.

```bash
git mv app/page.tsx app/\(app\)/page.tsx
```

- [ ] **Step 3: Verify dev server reloads + chat still works**

Run: `cmux browser goto http://localhost:3000`
Expected: Sidebar placeholder visible; chat input visible; ask "test" question; streaming response arrives (validates that the temporary page still works through the existing fetch+reader code).

- [ ] **Step 4: Commit**

```bash
git add app/\(app\)/layout.tsx app/\(app\)/page.tsx app/page.tsx
git commit -m "feat(routing): introduce (app) route group with placeholder shell"
```

---

## Phase 2 — Pure logic libraries (TDD)

### Task 2.1: Add vitest + typecheck script

**Files:**
- Modify: `package.json`
- Create: `vitest.config.ts`

- [ ] **Step 1: Install vitest**

```bash
npm install --save-dev --legacy-peer-deps vitest @vitest/ui happy-dom
```

- [ ] **Step 2: Create `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "happy-dom",
    globals: true,
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, ".") },
  },
});
```

- [ ] **Step 3: Add scripts to `package.json`**

Edit the `scripts` block in `package.json`:

```json
"scripts": {
  "dev": "next dev",
  "build": "next build",
  "start": "next start",
  "lint": "eslint",
  "typecheck": "tsc --noEmit",
  "test": "vitest run",
  "test:watch": "vitest"
}
```

- [ ] **Step 4: Run typecheck baseline**

Run: `npm run typecheck`
Expected: PASS (or any pre-existing errors are documented; baseline is zero new errors).

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json vitest.config.ts
git commit -m "chore: add vitest + typecheck scripts"
```

---

### Task 2.2: Conversation types + migrateConversation (TDD)

**Files:**
- Create: `lib/conversation.ts`
- Create: `lib/conversation.test.ts`

- [ ] **Step 1: Write failing test `lib/conversation.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { migrateConversation, type Conversation } from "./conversation";

describe("migrateConversation", () => {
  const baseLegacy = {
    id: "c1",
    title: "Old conv",
    messages: [{ role: "user", content: "hi" }, { role: "model", content: "hello" }],
    createdAt: "2026-04-01T00:00:00Z",
    updatedAt: "2026-04-01T00:00:00Z",
  };

  it("fills pinned/favorite/model defaults on legacy entry", () => {
    const out = migrateConversation(baseLegacy);
    expect(out.pinned).toBe(false);
    expect(out.favorite).toBe(false);
    expect(out.model).toBe("Auto-detect");
  });

  it("preserves existing pinned=true", () => {
    const out = migrateConversation({ ...baseLegacy, pinned: true });
    expect(out.pinned).toBe(true);
  });

  it("preserves existing favorite + model", () => {
    const out = migrateConversation({ ...baseLegacy, favorite: true, model: "335i • E92" });
    expect(out.favorite).toBe(true);
    expect(out.model).toBe("335i • E92");
  });

  it("preserves messages verbatim including role", () => {
    const out = migrateConversation(baseLegacy);
    expect(out.messages).toEqual(baseLegacy.messages);
  });

  it("returns null for non-object input", () => {
    expect(migrateConversation(null)).toBeNull();
    expect(migrateConversation("hi")).toBeNull();
  });

  it("returns null when required fields missing", () => {
    expect(migrateConversation({ id: "c1" })).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to confirm fail**

Run: `npm test`
Expected: FAIL — `migrateConversation is not a function`.

- [ ] **Step 3: Write `lib/conversation.ts`**

```ts
// lib/conversation.ts
export type StorageRole = "user" | "model";

export interface SourceCitation {
  id: string;
  score: number;
  preview: string;
}

export interface Message {
  role: StorageRole;
  content: string;
  sources?: SourceCitation[];
  thumbsUp?: boolean;
  thumbsDown?: boolean;
  latencyMs?: number;
  tokenCount?: number;
}

export interface Conversation {
  id: string;
  title: string;
  messages: Message[];
  createdAt: string;
  updatedAt: string;
  pinned?: boolean;
  favorite?: boolean;
  model?: string;
}

export type Bucket = "today" | "yesterday" | "week" | "older";

export function migrateConversation(raw: unknown): Conversation | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== "string" || typeof r.title !== "string" || !Array.isArray(r.messages)) {
    return null;
  }
  if (typeof r.createdAt !== "string" || typeof r.updatedAt !== "string") return null;

  return {
    id: r.id,
    title: r.title,
    messages: r.messages as Message[],
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    pinned: typeof r.pinned === "boolean" ? r.pinned : false,
    favorite: typeof r.favorite === "boolean" ? r.favorite : false,
    model: typeof r.model === "string" ? r.model : "Auto-detect",
  };
}
```

- [ ] **Step 4: Run test to confirm pass**

Run: `npm test`
Expected: PASS — 6/6 cases.

- [ ] **Step 5: Commit**

```bash
git add lib/conversation.ts lib/conversation.test.ts
git commit -m "feat(lib): Conversation types + migrateConversation with tests"
```

---

### Task 2.3: getBucket + derivePreview helpers (TDD)

**Files:**
- Modify: `lib/conversation.ts`
- Modify: `lib/conversation.test.ts`

- [ ] **Step 1: Append failing tests**

```ts
// lib/conversation.test.ts
import { describe, expect, it } from "vitest";
import {
  migrateConversation,
  getBucket,
  derivePreview,
  type Conversation,
  type Message,
} from "./conversation";

// (existing migrate tests preserved)

describe("getBucket", () => {
  const now = new Date("2026-05-02T12:00:00Z");

  it("returns 'today' for same calendar day", () => {
    expect(getBucket("2026-05-02T01:00:00Z", now)).toBe("today");
  });
  it("returns 'yesterday' for prior calendar day", () => {
    expect(getBucket("2026-05-01T23:00:00Z", now)).toBe("yesterday");
  });
  it("returns 'week' for 3 days ago", () => {
    expect(getBucket("2026-04-29T12:00:00Z", now)).toBe("week");
  });
  it("returns 'older' for 30 days ago", () => {
    expect(getBucket("2026-04-02T12:00:00Z", now)).toBe("older");
  });
});

describe("derivePreview", () => {
  it("returns first user message trimmed to 80 chars", () => {
    const msgs: Message[] = [
      { role: "user", content: "Why does my E90 335i hesitate when starting cold below 50°F? No CEL pulled and the issue persists for ~2s." },
      { role: "model", content: "It's HPFP." },
    ];
    expect(derivePreview(msgs)).toMatch(/^Why does my E90/);
    expect(derivePreview(msgs).length).toBeLessThanOrEqual(80);
  });
  it("returns empty string when no messages", () => {
    expect(derivePreview([])).toBe("");
  });
  it("returns empty string when only model messages", () => {
    expect(derivePreview([{ role: "model", content: "hi" }])).toBe("");
  });
});
```

- [ ] **Step 2: Run tests to confirm fail**

Run: `npm test`
Expected: FAIL — `getBucket / derivePreview are not exported`.

- [ ] **Step 3: Append to `lib/conversation.ts`**

```ts
export function getBucket(updatedAt: string, now: Date = new Date()): Bucket {
  const d = new Date(updatedAt);
  const dayMs = 86400 * 1000;
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const startOfYesterday = new Date(startOfToday.getTime() - dayMs);
  const startOfWeekAgo = new Date(startOfToday.getTime() - 7 * dayMs);

  if (d >= startOfToday) return "today";
  if (d >= startOfYesterday) return "yesterday";
  if (d >= startOfWeekAgo) return "week";
  return "older";
}

export function derivePreview(messages: Message[]): string {
  const firstUser = messages.find(m => m.role === "user");
  if (!firstUser) return "";
  const trimmed = firstUser.content.trim().replace(/\s+/g, " ");
  return trimmed.length <= 80 ? trimmed : trimmed.slice(0, 77) + "...";
}
```

- [ ] **Step 4: Run tests to confirm pass**

Run: `npm test`
Expected: PASS — all cases.

- [ ] **Step 5: Commit**

```bash
git add lib/conversation.ts lib/conversation.test.ts
git commit -m "feat(lib): getBucket + derivePreview with tests"
```

---

### Task 2.4: Sources annotation parser (TDD)

**Files:**
- Create: `lib/sources.ts`
- Create: `lib/sources.test.ts`

- [ ] **Step 1: Write failing test `lib/sources.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { parseSourcesAnnotation } from "./sources";

describe("parseSourcesAnnotation", () => {
  it("returns sources array from valid annotation", () => {
    const a = { type: "sources", sources: [{ id: "a", score: 0.9, preview: "abc" }] };
    expect(parseSourcesAnnotation(a)).toEqual([{ id: "a", score: 0.9, preview: "abc" }]);
  });

  it("returns null for null/undefined input", () => {
    expect(parseSourcesAnnotation(null)).toBeNull();
    expect(parseSourcesAnnotation(undefined)).toBeNull();
  });

  it("returns null for non-object input", () => {
    expect(parseSourcesAnnotation("foo")).toBeNull();
    expect(parseSourcesAnnotation(42)).toBeNull();
  });

  it("returns null when type !== 'sources'", () => {
    expect(parseSourcesAnnotation({ type: "other", sources: [] })).toBeNull();
  });

  it("returns null when sources is not an array", () => {
    expect(parseSourcesAnnotation({ type: "sources", sources: "x" })).toBeNull();
  });

  it("filters out malformed source entries", () => {
    const a = {
      type: "sources",
      sources: [
        { id: "a", score: 0.9, preview: "abc" },
        { id: "b" }, // missing score + preview
        { score: 0.5, preview: "no id" },
      ],
    };
    expect(parseSourcesAnnotation(a)).toEqual([{ id: "a", score: 0.9, preview: "abc" }]);
  });
});
```

- [ ] **Step 2: Run test to confirm fail**

Run: `npm test`
Expected: FAIL — `parseSourcesAnnotation is not a function`.

- [ ] **Step 3: Write `lib/sources.ts`**

```ts
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
```

- [ ] **Step 4: Run test to confirm pass**

Run: `npm test`
Expected: PASS — 6/6 cases.

- [ ] **Step 5: Commit**

```bash
git add lib/sources.ts lib/sources.test.ts
git commit -m "feat(lib): sources annotation parser with tests"
```

---

### Task 2.5: Theme/accent helpers

**Files:**
- Create: `lib/theme.ts`

- [ ] **Step 1: Create `lib/theme.ts`**

```ts
// lib/theme.ts
export type Theme = "midnight" | "graphite" | "abyss";
export type Accent = "blue" | "ice" | "violet" | "ember" | "forest";

export const THEMES: { id: Theme; label: string; from: string; to: string }[] = [
  { id: "midnight", label: "Midnight", from: "#0A0A0F", to: "#15151B" },
  { id: "graphite", label: "Graphite", from: "#1A1A1A", to: "#252525" },
  { id: "abyss",    label: "Abyss",    from: "#000004", to: "#0A0A18" },
];

export const ACCENTS: { id: Accent; swatch: string }[] = [
  { id: "blue",   swatch: "oklch(0.68 0.16 245)" },
  { id: "ice",    swatch: "oklch(0.78 0.10 220)" },
  { id: "violet", swatch: "oklch(0.65 0.18 285)" },
  { id: "ember",  swatch: "oklch(0.68 0.18 35)" },
  { id: "forest", swatch: "oklch(0.65 0.13 155)" },
];

const THEME_KEY = "bimmerllm_theme";
const ACCENT_KEY = "bimmerllm_accent";

export function applyTheme(t: Theme) {
  document.documentElement.dataset.theme = t;
  try { localStorage.setItem(THEME_KEY, t); } catch {}
}
export function applyAccent(a: Accent) {
  document.documentElement.dataset.accent = a;
  try { localStorage.setItem(ACCENT_KEY, a); } catch {}
}
export function getStoredTheme(): Theme {
  try {
    const v = localStorage.getItem(THEME_KEY);
    if (v === "midnight" || v === "graphite" || v === "abyss") return v;
  } catch {}
  return "midnight";
}
export function getStoredAccent(): Accent {
  try {
    const v = localStorage.getItem(ACCENT_KEY);
    if (v === "blue" || v === "ice" || v === "violet" || v === "ember" || v === "forest") return v;
  } catch {}
  return "blue";
}
```

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add lib/theme.ts
git commit -m "feat(lib): theme + accent constants and apply helpers"
```

---

### Task 2.6: Update ChatProvider with new schema + role mapping

**Files:**
- Modify: `components/chat-provider.tsx`

- [ ] **Step 1: Replace `components/chat-provider.tsx`**

```tsx
// components/chat-provider.tsx
"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  ReactNode,
  useCallback,
} from "react";
import {
  type Conversation,
  type Message,
  migrateConversation,
} from "@/lib/conversation";

const STORAGE_KEY = "bimmerllm_conversations_v1";

interface ChatContextValue {
  conversations: Conversation[];
  activeId: string | null;
  activeConversation: Conversation | null;
  setActiveId: (id: string) => void;
  createConversation: () => string;
  updateActiveConversation: (updater: (prev: Conversation) => Conversation) => void;
  togglePinned: (id: string) => void;
  toggleFavorite: (id: string) => void;
  setModel: (id: string, model: string) => void;
  setMessages: (id: string, messages: Message[]) => void;
}

const ChatContext = createContext<ChatContextValue | null>(null);

function loadFromStorage(): Conversation[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map(migrateConversation).filter((c): c is Conversation => c !== null);
  } catch {
    return [];
  }
}

export function ChatProvider({ children }: { children: ReactNode }) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const loaded = loadFromStorage();
    if (loaded.length > 0) {
      setConversations(loaded);
      setActiveId(loaded[0].id);
    } else {
      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      const initial: Conversation = {
        id,
        title: "New consultation",
        messages: [],
        createdAt: now,
        updatedAt: now,
        pinned: false,
        favorite: false,
        model: "Auto-detect",
      };
      setConversations([initial]);
      setActiveId(id);
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated || conversations.length === 0) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(conversations));
    } catch {}
  }, [conversations, hydrated]);

  const activeConversation = conversations.find(c => c.id === activeId) ?? null;

  const createConversation = useCallback(() => {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const conv: Conversation = {
      id,
      title: "New consultation",
      messages: [],
      createdAt: now,
      updatedAt: now,
      pinned: false,
      favorite: false,
      model: "Auto-detect",
    };
    setConversations(prev => [conv, ...prev]);
    setActiveId(id);
    return id;
  }, []);

  const updateActiveConversation = useCallback(
    (updater: (prev: Conversation) => Conversation) => {
      setConversations(prev =>
        prev.map(c => {
          if (c.id !== activeId) return c;
          const updated = updater(c);
          return { ...updated, updatedAt: new Date().toISOString() };
        })
      );
    },
    [activeId]
  );

  const togglePinned = useCallback((id: string) => {
    setConversations(prev =>
      prev.map(c => (c.id === id ? { ...c, pinned: !c.pinned, updatedAt: new Date().toISOString() } : c))
    );
  }, []);

  const toggleFavorite = useCallback((id: string) => {
    setConversations(prev =>
      prev.map(c => (c.id === id ? { ...c, favorite: !c.favorite, updatedAt: new Date().toISOString() } : c))
    );
  }, []);

  const setModel = useCallback((id: string, model: string) => {
    setConversations(prev =>
      prev.map(c => (c.id === id ? { ...c, model, updatedAt: new Date().toISOString() } : c))
    );
  }, []);

  const setMessages = useCallback((id: string, messages: Message[]) => {
    setConversations(prev =>
      prev.map(c => (c.id === id ? { ...c, messages, updatedAt: new Date().toISOString() } : c))
    );
  }, []);

  return (
    <ChatContext.Provider
      value={{
        conversations,
        activeId,
        activeConversation,
        setActiveId,
        createConversation,
        updateActiveConversation,
        togglePinned,
        toggleFavorite,
        setModel,
        setMessages,
      }}
    >
      {children}
    </ChatContext.Provider>
  );
}

export function useChat() {
  const ctx = useContext(ChatContext);
  if (!ctx) throw new Error("useChat must be used within ChatProvider");
  return ctx;
}
```

- [ ] **Step 2: Verify typecheck still passes**

Run: `npm run typecheck`
Expected: PASS. The temporary `(app)/page.tsx` may have type errors against the new schema; if so, leave them for now — Phase 5 replaces it.

If errors block the build:
- Loosen the temporary page by casting `messages` to `any[]` at the use site, or
- Skip typecheck by setting `tsc --noEmit --skipLibCheck` until Phase 5.

- [ ] **Step 3: Reload browser, verify chat still loads existing conversations**

Run: `cmux browser reload`
Expected: Sidebar placeholder visible; chat input still works; localStorage persists across reload.

- [ ] **Step 4: Commit**

```bash
git add components/chat-provider.tsx
git commit -m "feat(chat-provider): extend Conversation schema with pinned/favorite/model + new actions"
```

---

## Phase 3 — Sidebar

### Task 3.1: Brand component

**Files:**
- Create: `components/sidebar/Brand.tsx`

- [ ] **Step 1: Create file**

```tsx
// components/sidebar/Brand.tsx
export function Brand() {
  return (
    <div className="flex items-center gap-2.5 px-2 pb-3.5 pt-2 border-b border-[var(--line-1)] mb-2.5">
      <div
        className="relative w-8 h-8 rounded-lg"
        style={{
          background: "linear-gradient(135deg, oklch(0.45 0.13 245), oklch(0.30 0.10 250))",
          boxShadow: "0 0 0 1px var(--line-2), 0 4px 12px oklch(0.45 0.13 245 / 0.3)",
        }}
      >
        <span className="absolute w-1.5 h-1.5 rounded-[1.5px] bg-[var(--text-1)] opacity-90" style={{ top: 9, left: 9 }} />
        <span className="absolute w-1.5 h-1.5 rounded-[1.5px] bg-[var(--text-1)] opacity-60" style={{ top: 9, left: 17 }} />
        <span className="absolute w-1.5 h-1.5 rounded-[1.5px] bg-[var(--text-1)] opacity-70" style={{ top: 17, left: 13 }} />
      </div>
      <div className="flex flex-col leading-tight">
        <div className="font-semibold text-[13.5px] tracking-tight">bimmerllm</div>
        <div className="font-mono text-[10px] text-[var(--text-3)] mt-0.5">v 0.2 · consultant</div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add components/sidebar/Brand.tsx
git commit -m "feat(sidebar): Brand component with gradient logo + 3 dots"
```

---

### Task 3.2: Icons set

**Files:**
- Create: `components/ui/icons.tsx`

- [ ] **Step 1: Create file** (port from `/Users/stanyan/Downloads/bimmerllm/src/icons.jsx`; use lucide-react where available, custom paths for the rest)

```tsx
// components/ui/icons.tsx
import {
  Plus, Search, MessageSquare, History, Star, Settings, User,
  ChevronDown, ChevronRight, X as Close, Copy, RotateCcw as Refresh,
  ThumbsUp, ThumbsDown, Edit, Trash2 as Trash, Bookmark, Pin, Sparkles as Sparkle,
  Mic, Paperclip, ArrowUp, Square as Stop, Wrench, Gauge, Zap as Bolt,
  FileText as Doc, Car, Check, LogOut as Logout,
} from "lucide-react";

export const I = {
  Plus, Search, Chat: MessageSquare, History, Star, Settings, User,
  ChevronDown, ChevronRight, Close, Copy, Refresh, ThumbsUp, ThumbsDown,
  Edit, Trash, Bookmark, Pin, Sparkle, Mic, Paperclip, ArrowUp, Stop,
  Wrench, Gauge, Bolt, Doc, Car, Check, Logout,
};

export type IconName = keyof typeof I;
```

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add components/ui/icons.tsx
git commit -m "feat(ui): icon registry mapping mockup names to lucide-react"
```

---

### Task 3.3: NavItems component

**Files:**
- Create: `components/sidebar/NavItems.tsx`

- [ ] **Step 1: Create file**

```tsx
// components/sidebar/NavItems.tsx
"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { I } from "@/components/ui/icons";

const items = [
  { href: "/", label: "Chat", icon: I.Chat },
  { href: "/library", label: "Library", icon: I.History },
  { href: "/settings", label: "Settings", icon: I.Settings },
] as const;

export function NavItems() {
  const pathname = usePathname() ?? "/";
  return (
    <nav className="flex flex-col gap-px mb-2.5">
      {items.map(({ href, label, icon: Icon }) => {
        const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            className={`flex items-center gap-2.5 px-2.5 py-2 rounded-md text-[13px] font-medium transition-colors ${
              active
                ? "bg-[var(--bg-3)] text-[var(--text-1)]"
                : "text-[var(--text-2)] hover:bg-[var(--bg-3)] hover:text-[var(--text-1)]"
            }`}
          >
            <Icon size={15} />
            <span>{label}</span>
            {active && href === "/" && (
              <span
                className="ml-auto w-1.5 h-1.5 rounded-full"
                style={{ background: "var(--accent)", boxShadow: "0 0 8px var(--accent)" }}
              />
            )}
          </Link>
        );
      })}
    </nav>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add components/sidebar/NavItems.tsx
git commit -m "feat(sidebar): NavItems with active route highlight"
```

---

### Task 3.4: NewConsultationButton

**Files:**
- Create: `components/sidebar/NewConsultationButton.tsx`

- [ ] **Step 1: Create file**

```tsx
// components/sidebar/NewConsultationButton.tsx
"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useChat } from "@/components/chat-provider";
import { I } from "@/components/ui/icons";

export function NewConsultationButton() {
  const router = useRouter();
  const { createConversation } = useChat();

  const onClick = () => {
    createConversation();
    router.push("/");
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "n") {
        e.preventDefault();
        onClick();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <button
      onClick={onClick}
      className="flex items-center gap-2 px-2.5 py-2 rounded-lg text-[var(--text-1)] text-[13px] font-medium cursor-pointer transition-colors my-1.5 mb-3"
      style={{
        background: "linear-gradient(180deg, var(--bg-3), var(--bg-2))",
        border: "1px solid var(--line-2)",
      }}
    >
      <I.Plus size={14} />
      <span>New consultation</span>
      <span className="ml-auto flex gap-0.5">
        <span className="kbd">⌘</span>
        <span className="kbd">N</span>
      </span>
    </button>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add components/sidebar/NewConsultationButton.tsx
git commit -m "feat(sidebar): NewConsultationButton with ⌘N shortcut"
```

---

### Task 3.5: SearchBox

**Files:**
- Create: `components/sidebar/SearchBox.tsx`

- [ ] **Step 1: Create file**

```tsx
// components/sidebar/SearchBox.tsx
"use client";
import { I } from "@/components/ui/icons";

export function SearchBox({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex items-center gap-2 px-2.5 h-8 rounded-md mb-3.5 border border-[var(--line-1)] bg-[var(--bg-1)] text-[var(--text-3)]">
      <I.Search size={14} />
      <input
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder="Search consultations…"
        className="flex-1 min-w-0 bg-transparent border-0 outline-none text-[var(--text-1)] text-[12.5px]"
      />
      {value && (
        <button onClick={() => onChange("")} className="text-[var(--text-3)] cursor-pointer p-0.5 flex items-center hover:text-[var(--text-1)]">
          <I.Close size={12} />
        </button>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add components/sidebar/SearchBox.tsx
git commit -m "feat(sidebar): SearchBox component"
```

---

### Task 3.6: ThreadGroup + ThreadItem

**Files:**
- Create: `components/sidebar/ThreadItem.tsx`
- Create: `components/sidebar/ThreadGroup.tsx`

- [ ] **Step 1: Create `ThreadItem.tsx`**

```tsx
// components/sidebar/ThreadItem.tsx
"use client";
import { I } from "@/components/ui/icons";
import type { Conversation } from "@/lib/conversation";

interface Props {
  c: Conversation;
  active: boolean;
  onClick: () => void;
}

export function ThreadItem({ c, active, onClick }: Props) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2 px-2 py-1.5 rounded-md w-full text-left transition-colors ${
        active ? "bg-[var(--bg-3)] ring-1 ring-inset ring-[var(--line-2)]" : "bg-transparent hover:bg-[var(--bg-3)]"
      }`}
    >
      <span className="w-3.5 h-3.5 flex items-center justify-center text-[var(--accent)] opacity-80 shrink-0">
        {c.favorite && <I.Star size={9} />}
      </span>
      <div className="flex-1 min-w-0">
        <div className="text-[12.5px] text-[var(--text-1)] font-normal truncate">{c.title}</div>
        {c.model && (
          <div className="text-[10.5px] text-[var(--text-3)] font-mono truncate mt-0.5">{c.model}</div>
        )}
      </div>
    </button>
  );
}
```

- [ ] **Step 2: Create `ThreadGroup.tsx`**

```tsx
// components/sidebar/ThreadGroup.tsx
import { I, type IconName } from "@/components/ui/icons";

interface Props {
  label: string;
  icon?: IconName;
  children: React.ReactNode;
}

export function ThreadGroup({ label, icon, children }: Props) {
  const Icon = icon ? I[icon] : null;
  return (
    <div className="mb-3.5">
      <div className="flex items-center gap-1.5 px-2 pb-1.5 text-[10px] font-semibold text-[var(--text-3)] uppercase tracking-wider font-mono">
        {Icon && <Icon size={11} />}
        <span>{label}</span>
      </div>
      <div className="flex flex-col gap-px">{children}</div>
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add components/sidebar/ThreadItem.tsx components/sidebar/ThreadGroup.tsx
git commit -m "feat(sidebar): ThreadGroup + ThreadItem"
```

---

### Task 3.7: ThreadList (groups by pinned + bucket)

**Files:**
- Create: `components/sidebar/ThreadList.tsx`

- [ ] **Step 1: Create file**

```tsx
// components/sidebar/ThreadList.tsx
"use client";
import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { useChat } from "@/components/chat-provider";
import { getBucket, type Conversation, type Bucket } from "@/lib/conversation";
import { ThreadGroup } from "./ThreadGroup";
import { ThreadItem } from "./ThreadItem";

export function ThreadList({ query }: { query: string }) {
  const router = useRouter();
  const { conversations, activeId, setActiveId } = useChat();

  const grouped = useMemo(() => {
    const filtered = conversations.filter(c =>
      !query || c.title.toLowerCase().includes(query.toLowerCase()) ||
      (c.model || "").toLowerCase().includes(query.toLowerCase())
    );
    const pinned = filtered.filter(c => c.pinned);
    const rest = filtered.filter(c => !c.pinned);
    const buckets: Record<Bucket, Conversation[]> = { today: [], yesterday: [], week: [], older: [] };
    rest.forEach(c => buckets[getBucket(c.updatedAt)].push(c));
    return { pinned, ...buckets };
  }, [conversations, query]);

  const open = (id: string) => {
    setActiveId(id);
    router.push("/");
  };

  return (
    <div className="flex-1 overflow-y-auto -mx-1 px-1 no-scrollbar">
      {grouped.pinned.length > 0 && (
        <ThreadGroup label="Pinned" icon="Pin">
          {grouped.pinned.map(c => (
            <ThreadItem key={c.id} c={c} active={c.id === activeId} onClick={() => open(c.id)} />
          ))}
        </ThreadGroup>
      )}
      {grouped.today.length > 0 && (
        <ThreadGroup label="Today">
          {grouped.today.map(c => (
            <ThreadItem key={c.id} c={c} active={c.id === activeId} onClick={() => open(c.id)} />
          ))}
        </ThreadGroup>
      )}
      {grouped.yesterday.length > 0 && (
        <ThreadGroup label="Yesterday">
          {grouped.yesterday.map(c => (
            <ThreadItem key={c.id} c={c} active={c.id === activeId} onClick={() => open(c.id)} />
          ))}
        </ThreadGroup>
      )}
      {grouped.week.length > 0 && (
        <ThreadGroup label="Past 7 days">
          {grouped.week.map(c => (
            <ThreadItem key={c.id} c={c} active={c.id === activeId} onClick={() => open(c.id)} />
          ))}
        </ThreadGroup>
      )}
      {grouped.older.length > 0 && (
        <ThreadGroup label="Older">
          {grouped.older.map(c => (
            <ThreadItem key={c.id} c={c} active={c.id === activeId} onClick={() => open(c.id)} />
          ))}
        </ThreadGroup>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add components/sidebar/ThreadList.tsx
git commit -m "feat(sidebar): ThreadList grouping by pinned + bucket"
```

---

### Task 3.8: UserFooter (Guest)

**Files:**
- Create: `components/sidebar/UserFooter.tsx`

- [ ] **Step 1: Create file**

```tsx
// components/sidebar/UserFooter.tsx
"use client";
import { useRouter } from "next/navigation";
import { I } from "@/components/ui/icons";

export function UserFooter() {
  const router = useRouter();
  return (
    <button
      onClick={() => router.push("/settings")}
      className="flex items-center gap-2.5 px-3 py-2.5 -mx-1 border-t border-[var(--line-1)] mt-1.5 cursor-pointer text-[var(--text-2)] transition-colors hover:bg-[var(--bg-3)] w-full text-left"
    >
      <div
        className="w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-semibold text-[var(--text-1)] shrink-0"
        style={{ background: "linear-gradient(135deg, oklch(0.65 0.16 245), oklch(0.50 0.14 250))" }}
      >
        G
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-[12.5px] text-[var(--text-1)] font-medium truncate">Guest</div>
        <div className="text-[10.5px] text-[var(--text-3)] font-mono truncate mt-px">local session</div>
      </div>
      <I.ChevronRight size={14} />
    </button>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add components/sidebar/UserFooter.tsx
git commit -m "feat(sidebar): UserFooter (Guest, links to settings)"
```

---

### Task 3.9: Sidebar root + wire into layout

**Files:**
- Create: `components/sidebar/Sidebar.tsx`
- Modify: `app/(app)/layout.tsx`

- [ ] **Step 1: Create `components/sidebar/Sidebar.tsx`**

```tsx
// components/sidebar/Sidebar.tsx
"use client";
import { useState } from "react";
import { Brand } from "./Brand";
import { NavItems } from "./NavItems";
import { NewConsultationButton } from "./NewConsultationButton";
import { SearchBox } from "./SearchBox";
import { ThreadList } from "./ThreadList";
import { UserFooter } from "./UserFooter";

export function Sidebar() {
  const [query, setQuery] = useState("");
  return (
    <aside
      className="hidden md:flex flex-col w-[268px] shrink-0 h-full p-3 border-r border-[var(--line-1)] bg-[var(--bg-2)]"
    >
      <Brand />
      <NavItems />
      <NewConsultationButton />
      <SearchBox value={query} onChange={setQuery} />
      <ThreadList query={query} />
      <UserFooter />
    </aside>
  );
}
```

- [ ] **Step 2: Replace `app/(app)/layout.tsx`**

```tsx
// app/(app)/layout.tsx
import { Sidebar } from "@/components/sidebar/Sidebar";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-svh w-full">
      <Sidebar />
      <main className="flex-1 min-w-0 flex flex-col bg-[var(--bg-1)]">
        {children}
      </main>
    </div>
  );
}
```

- [ ] **Step 3: Verify in browser**

Run: `cmux browser reload` then `cmux browser screenshot --out /tmp/cmux-bimmerllm-sidebar.png`
Expected: Sidebar renders with Brand + Chat/Library/Settings nav (Chat active) + New consultation button + search + grouped threads + Guest footer.

- [ ] **Step 4: Commit**

```bash
git add components/sidebar/Sidebar.tsx app/\(app\)/layout.tsx
git commit -m "feat(sidebar): root component composing brand/nav/threads/footer"
```

---

## Phase 4 — Backend rewrite

### Task 4.1: Add @ai-sdk/google + langsmith deps

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install packages**

```bash
npm install --legacy-peer-deps @ai-sdk/google langsmith
```

- [ ] **Step 2: Verify peer-dep warnings only (not errors)**

Run: `npm install --legacy-peer-deps 2>&1 | grep -E '^npm error' | head`
Expected: No new errors (the existing langchain peer warning is acceptable).

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore(deps): add @ai-sdk/google + promote langsmith to explicit dep"
```

---

### Task 4.2: Pinecone + Google AI singletons

**Files:**
- Create: `lib/ai/pinecone.ts`
- Create: `lib/ai/google.ts`

- [ ] **Step 1: Create `lib/ai/pinecone.ts`**

```ts
// lib/ai/pinecone.ts
import { Pinecone } from "@pinecone-database/pinecone";

let _client: Pinecone | null = null;
export function pinecone() {
  if (!_client) _client = new Pinecone({ apiKey: process.env.PINECONE_API_KEY! });
  return _client;
}

export const BIMMERPOST_INDEX = "bmw-datas";
export const BIMMERPOST_NAMESPACE = "bimmerpost";

export function bimmerpostNamespace() {
  return pinecone().index(BIMMERPOST_INDEX).namespace(BIMMERPOST_NAMESPACE);
}
```

- [ ] **Step 2: Create `lib/ai/google.ts`**

```ts
// lib/ai/google.ts
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";

export const aiSdkGoogle = createGoogleGenerativeAI({
  apiKey: process.env.GEMINI_API_KEY!,
});

export const langchainGemini = new ChatGoogleGenerativeAI({
  model: "gemini-2.5-flash-lite",
  apiKey: process.env.GEMINI_API_KEY!,
  temperature: 0.2,
});

export const GEMINI_MODEL_ID = "gemini-2.5-flash-lite";
```

- [ ] **Step 3: Run typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add lib/ai/pinecone.ts lib/ai/google.ts
git commit -m "feat(lib/ai): Pinecone + Gemini provider singletons"
```

---

### Task 4.3: Rewrite route.ts with AI SDK v5 + sources annotation

**Files:**
- Rewrite: `app/api/chat/route.ts`

- [ ] **Step 1: Replace `app/api/chat/route.ts`**

```ts
// app/api/chat/route.ts
import { traceable } from "langsmith/traceable";
import { streamText, type UIMessage, convertToModelMessages, createUIMessageStream, createUIMessageStreamResponse } from "ai";
import { aiSdkGoogle, GEMINI_MODEL_ID, langchainGemini } from "@/lib/ai/google";
import { bimmerpostNamespace } from "@/lib/ai/pinecone";
import type { SourceCitation } from "@/lib/conversation";

export const runtime = "nodejs";
export const maxDuration = 60;

interface SearchHit {
  _id: string;
  _score: number;
  fields?: { answers?: string };
}
interface SearchResponse {
  result?: { hits: SearchHit[] };
}

interface ChatBody {
  messages: UIMessage[];
  vehicleContext?: string;
}

const reformulate = traceable(
  async (currentQuestion: string, history: UIMessage[], vehicleContext: string) => {
    const vehicleHint = vehicleContext === "Auto-detect" || !vehicleContext
      ? "no specific vehicle"
      : vehicleContext;

    const prompt = history.length === 0
      ? `Translate the following BMW question to an English search query for a forum knowledge base.
User's vehicle context: ${vehicleHint}.
Question: ${currentQuestion}
Output ONLY the English query string.`
      : `Given the following conversation history and a follow-up question, rephrase the follow-up to a standalone English search query for a BMW forum knowledge base.
User's vehicle context: ${vehicleHint}.

Chat history:
${history.map(m => `${m.role}: ${extractText(m)}`).join("\n")}

Follow-up: ${currentQuestion}

Output ONLY the English query string.`;

    try {
      const res = await langchainGemini.invoke([{ role: "user", content: prompt }]);
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
      return hits.map(h => ({
        id: h._id,
        score: h._score,
        preview: (h.fields?.answers ?? "").slice(0, 240),
      }));
    } catch (err) {
      console.error("[retrieve] Pinecone search failed:", err);
      return [];
    }
  },
  { name: "retrieve" }
);

function extractText(m: UIMessage): string {
  // AI SDK v5 messages have parts; older entries may carry raw content.
  const anyM = m as unknown as { content?: string; parts?: { type: string; text?: string }[] };
  if (anyM.parts && Array.isArray(anyM.parts)) {
    return anyM.parts.filter(p => p.type === "text").map(p => p.text ?? "").join("");
  }
  return anyM.content ?? "";
}

const handler = traceable(
  async (req: Request) => {
    const body = (await req.json()) as ChatBody;
    const messages = body.messages ?? [];
    const vehicleContext = body.vehicleContext || "Auto-detect";

    if (messages.length === 0) {
      return new Response(JSON.stringify({ error: "messages array required" }), { status: 400 });
    }

    const last = messages[messages.length - 1];
    const history = messages.slice(0, -1);
    const currentQuestion = extractText(last);

    const searchInput = await reformulate(currentQuestion, history, vehicleContext);
    const sources = await retrieve(searchInput);

    const contextText = sources.length > 0
      ? sources.map(s => s.preview).join("\n\n---\n\n")
      : "参考资料库暂时无法访问。请基于你已有的 BMW 知识谨慎回答。";

    const vehicleHint = vehicleContext === "Auto-detect" || !vehicleContext
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

    const stream = createUIMessageStream({
      execute: ({ writer }) => {
        // Emit sources annotation BEFORE the assistant message starts streaming.
        // If AI SDK v5 strict mode rejects pre-message annotations, the implementer
        // should fall back to writing the annotation in `onChunk` of streamText
        // (first text chunk), or in `onFinish`. The UI tolerates both timings.
        writer.write({
          type: "data-sources",
          data: { type: "sources", sources },
          transient: false,
        });

        const result = streamText({
          model: aiSdkGoogle(GEMINI_MODEL_ID),
          system,
          messages: convertToModelMessages(messages),
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
```

- [ ] **Step 2: Run typecheck**

Run: `npm run typecheck`
Expected: PASS (or document any AI SDK type drift; the implementer may need to adjust based on the actual `ai@5.0.98` API surface).

If `createUIMessageStream` / `createUIMessageStreamResponse` don't exist in `ai@5.0.98`, fall back to `streamText({...}).toUIMessageStreamResponse({ messageMetadata: () => ({ sources }) })` and have the client read `message.metadata?.sources`. Document the chosen path in a code comment.

- [ ] **Step 3: Smoke-test in browser**

Run: `cmux browser goto http://localhost:3000`
The temporary `(app)/page.tsx` still uses the OLD plain-text fetch+reader, so the chat will likely BREAK at this point. That's expected — Phase 5 replaces the page with a `useChat`-based ChatPage. Verify with curl instead:

```bash
curl -N -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"id":"u1","role":"user","parts":[{"type":"text","text":"E90 335i 烧机油怎么修"}]}],"vehicleContext":"335i • E92"}'
```

Expected: Stream of UI message events including a `data-sources` part early on, then `text-start` / `text-delta` / `text-end` / `finish`.

- [ ] **Step 4: Commit**

```bash
git add app/api/chat/route.ts
git commit -m "feat(api): rewrite /api/chat with AI SDK v5 streamText + sources annotation + vehicleContext"
```

---

## Phase 5 — ChatPage with useChat

### Task 5.1: Composer

**Files:**
- Create: `components/chat/Composer.tsx`

- [ ] **Step 1: Create file** (port from mockup `Composer`, drop attach + mic per spec)

```tsx
// components/chat/Composer.tsx
"use client";
import { I } from "@/components/ui/icons";

interface Props {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  onStop: () => void;
  streaming: boolean;
  disabled: boolean;
}

export function Composer({ value, onChange, onSend, onStop, streaming, disabled }: Props) {
  const canSend = value.trim().length > 0 && !disabled;
  return (
    <div className="max-w-[720px] mx-auto w-full">
      <div
        className="flex items-center gap-1.5 pl-3.5 pr-2 py-2 rounded-full transition-colors"
        style={{
          background: "var(--bg-3)",
          border: "1px solid var(--line-2)",
          boxShadow: "0 8px 24px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.04)",
        }}
      >
        <input
          value={value}
          onChange={e => onChange(e.target.value)}
          onKeyDown={e => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              if (canSend) onSend();
            }
          }}
          placeholder="Ask about a fault, a model, or a procedure…"
          className="flex-1 min-w-0 bg-transparent border-0 outline-none text-[var(--text-1)] text-sm py-1.5"
          disabled={disabled}
        />
        <button
          onClick={() => (streaming ? onStop() : canSend && onSend())}
          disabled={!streaming && !canSend}
          className="w-8 h-8 rounded-full border-0 cursor-pointer flex items-center justify-center shrink-0 transition-colors disabled:cursor-not-allowed"
          style={{
            background: streaming || canSend ? "var(--accent)" : "var(--bg-3)",
            color: streaming || canSend ? "#0A0A0F" : "var(--text-3)",
          }}
        >
          {streaming ? <I.Stop size={13} /> : <I.ArrowUp size={15} />}
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add components/chat/Composer.tsx
git commit -m "feat(chat): Composer (input + send/stop, no attach/mic per V1 spec)"
```

---

### Task 5.2: ModelPicker

**Files:**
- Create: `components/chat/ModelPicker.tsx`

- [ ] **Step 1: Create file**

```tsx
// components/chat/ModelPicker.tsx
"use client";
import { useState } from "react";
import { I } from "@/components/ui/icons";

const OPTIONS = ["Auto-detect", "335i • E92", "M3 • F80", "M340i • G20", "M5 • F90", "X5 • G05", "M2 • G87", "M3 • E46"];

interface Props {
  value: string;
  onChange: (v: string) => void;
}

export function ModelPicker({ value, onChange }: Props) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-2 px-2.5 py-1.5 rounded-md text-[var(--text-1)] text-xs cursor-pointer"
        style={{ background: "var(--bg-3)", border: "1px solid var(--line-2)" }}
      >
        <I.Car size={13} />
        <span className="font-mono">{value}</span>
        <I.ChevronDown size={11} />
      </button>
      {open && (
        <>
          <div onClick={() => setOpen(false)} className="fixed inset-0 z-30" />
          <div
            className="absolute right-0 mt-1.5 min-w-[200px] z-40 rounded-xl p-1"
            style={{
              background: "var(--bg-elev)",
              border: "1px solid var(--line-2)",
              boxShadow: "var(--shadow-lg)",
            }}
          >
            {OPTIONS.map(o => (
              <button
                key={o}
                onClick={() => { onChange(o); setOpen(false); }}
                className={`flex items-center gap-2 w-full px-2.5 py-1.5 text-xs font-mono rounded-md cursor-pointer text-left ${
                  o === value ? "bg-[var(--bg-3)] text-[var(--text-1)]" : "text-[var(--text-1)] hover:bg-[var(--bg-3)]"
                }`}
              >
                {o === value ? <I.Check size={11} /> : <span className="w-[11px]" />}
                <span>{o}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export const VEHICLE_OPTIONS = OPTIONS;
```

- [ ] **Step 2: Commit**

```bash
git add components/chat/ModelPicker.tsx
git commit -m "feat(chat): ModelPicker dropdown"
```

---

### Task 5.3: Topbar

**Files:**
- Create: `components/chat/Topbar.tsx`

- [ ] **Step 1: Create file**

```tsx
// components/chat/Topbar.tsx
"use client";
import { I } from "@/components/ui/icons";
import { ModelPicker } from "./ModelPicker";

interface Props {
  title: string;
  isEmpty: boolean;
  vehicleContext: string;
  setVehicleContext: (v: string) => void;
  onBookmark: () => void;
  bookmarked: boolean;
  onRegenerate: () => void;
  canRegenerate: boolean;
}

export function Topbar({
  title, isEmpty, vehicleContext, setVehicleContext,
  onBookmark, bookmarked, onRegenerate, canRegenerate,
}: Props) {
  return (
    <header className="h-[52px] shrink-0 flex items-center justify-between px-6 border-b border-[var(--line-1)] bg-[var(--bg-1)]">
      <div className="flex items-center gap-2 text-[12.5px]">
        <span className="font-mono text-[10.5px] uppercase tracking-wider text-[var(--text-3)]">Consultation</span>
        <I.ChevronRight size={11} className="text-[var(--text-3)]" />
        <span className="text-[var(--text-1)] font-medium">{isEmpty ? "New session" : title}</span>
      </div>
      <div className="flex items-center gap-2">
        <ModelPicker value={vehicleContext} onChange={setVehicleContext} />
        <button
          onClick={onBookmark}
          title={bookmarked ? "Unpin" : "Pin"}
          className={`p-1.5 rounded-md cursor-pointer ${bookmarked ? "text-[var(--accent-hi)]" : "text-[var(--text-2)]"} hover:bg-[var(--bg-3)] hover:text-[var(--text-1)]`}
        >
          <I.Bookmark size={14} />
        </button>
        <button
          onClick={onRegenerate}
          disabled={!canRegenerate}
          title="Regenerate last answer"
          className="p-1.5 rounded-md text-[var(--text-2)] cursor-pointer hover:bg-[var(--bg-3)] hover:text-[var(--text-1)] disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <I.Refresh size={14} />
        </button>
      </div>
    </header>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add components/chat/Topbar.tsx
git commit -m "feat(chat): Topbar with breadcrumb + ModelPicker + bookmark + regenerate"
```

---

### Task 5.4: Welcome (suggested prompts)

**Files:**
- Create: `components/chat/Welcome.tsx`

- [ ] **Step 1: Create file**

```tsx
// components/chat/Welcome.tsx
"use client";
import { I, type IconName } from "@/components/ui/icons";

const SUGGESTED: { icon: IconName; title: string; body: string }[] = [
  { icon: "Wrench", title: "Diagnose a fault", body: "Decode a CEL, plausibility, or DTC pattern" },
  { icon: "Gauge",  title: "Compare two models", body: "M340i vs 540i — daily comfort, drive feel" },
  { icon: "Bolt",   title: "Tuning consultation", body: "Stage 1 vs Stage 2 on the B58 — what's safe?" },
  { icon: "Doc",    title: "Service interval", body: "When should I change ZF8HP fluid on a 2020+?" },
];

export function Welcome({ onPick }: { onPick: (s: string) => void }) {
  return (
    <div className="max-w-[720px] mx-auto mt-[8vh] flex flex-col gap-7 animate-fadeUp">
      <div className="flex flex-col gap-3.5">
        <h1 className="text-[32px] font-medium tracking-tight leading-tight text-[var(--text-1)]">
          What are we troubleshooting today?
        </h1>
        <p className="text-sm leading-relaxed text-[var(--text-3)] max-w-[540px]">
          A senior-level consultant for BMW ownership — diagnostics, coding, modifications,
          and buying advice. Trained on bimmerpost forum knowledge.
        </p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {SUGGESTED.map((p, i) => {
          const Icon = I[p.icon];
          return (
            <button
              key={i}
              onClick={() => onPick(`${p.title}: ${p.body}`)}
              className="flex items-center gap-3 p-3.5 rounded-xl text-left transition-all bg-[var(--bg-3)] border border-[var(--line-2)] hover:bg-[var(--bg-4)] hover:border-[var(--line-3)] cursor-pointer text-[var(--text-1)]"
            >
              <div
                className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
                style={{ background: "var(--accent-soft)", color: "var(--accent-hi)" }}
              >
                <Icon size={16} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[13px] font-medium text-[var(--text-1)]">{p.title}</div>
                <div className="text-[11.5px] text-[var(--text-3)] mt-0.5">{p.body}</div>
              </div>
              <I.ChevronRight size={13} className="text-[var(--text-3)]" />
            </button>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add components/chat/Welcome.tsx
git commit -m "feat(chat): Welcome empty state with suggested prompts"
```

---

### Task 5.5: ThinkingDots

**Files:**
- Create: `components/chat/ThinkingDots.tsx`

- [ ] **Step 1: Create file**

```tsx
// components/chat/ThinkingDots.tsx
export function ThinkingDots() {
  const dot = "inline-block w-1.5 h-1.5 rounded-full";
  return (
    <div className="flex items-center gap-1 text-[var(--text-3)] text-[12.5px] font-mono py-0.5">
      <span className={dot} style={{ background: "var(--accent)", animation: "pulseSoft 1.2s ease-in-out infinite" }} />
      <span className={dot} style={{ background: "var(--accent)", animation: "pulseSoft 1.2s ease-in-out infinite", animationDelay: "0.15s" }} />
      <span className={dot} style={{ background: "var(--accent)", animation: "pulseSoft 1.2s ease-in-out infinite", animationDelay: "0.30s" }} />
      <span className="ml-2">Retrieving from bimmerpost, consulting…</span>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add components/chat/ThinkingDots.tsx
git commit -m "feat(chat): ThinkingDots placeholder for streaming start"
```

---

### Task 5.6: SourcesPanel

**Files:**
- Create: `components/chat/SourcesPanel.tsx`

- [ ] **Step 1: Create file**

```tsx
// components/chat/SourcesPanel.tsx
"use client";
import { useState } from "react";
import { I } from "@/components/ui/icons";
import type { SourceCitation } from "@/lib/conversation";

export function SourcesPanel({ sources }: { sources: SourceCitation[] }) {
  const [open, setOpen] = useState(false);
  if (sources.length === 0) return null;
  return (
    <div className="text-xs text-[var(--text-3)]">
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1.5 cursor-pointer hover:text-[var(--text-1)] transition-colors"
      >
        <I.ChevronRight
          size={11}
          style={{ transform: open ? "rotate(90deg)" : "none", transition: "transform 0.15s" }}
        />
        <span>{sources.length} sources cited</span>
      </button>
      {open && (
        <div className="mt-2 flex flex-col gap-2 pl-4 border-l border-[var(--line-2)]">
          {sources.map((s, i) => (
            <div key={s.id + i} className="flex flex-col gap-1">
              <div className="font-mono text-[10.5px] text-[var(--text-3)]">
                #{i + 1} · score {s.score.toFixed(2)} · {s.id}
              </div>
              <div className="text-[12.5px] text-[var(--text-2)] leading-relaxed">{s.preview}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add components/chat/SourcesPanel.tsx
git commit -m "feat(chat): SourcesPanel collapsible citation viewer"
```

---

### Task 5.7: ActionsBar

**Files:**
- Create: `components/chat/ActionsBar.tsx`

- [ ] **Step 1: Create file**

```tsx
// components/chat/ActionsBar.tsx
"use client";
import { useState } from "react";
import { I, type IconName } from "@/components/ui/icons";

interface Props {
  content: string;
  onRegenerate: () => void;
  onThumbsUp: () => void;
  onThumbsDown: () => void;
  thumbsUp?: boolean;
  thumbsDown?: boolean;
  latencyMs?: number;
  tokenCount?: number;
}

function ActionBtn({ icon, label, active, onClick }: { icon: IconName; label?: string; active?: boolean; onClick: () => void }) {
  const Icon = I[icon];
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1 px-1.5 py-1 rounded-md text-[11px] cursor-pointer transition-colors ${
        active ? "text-[var(--accent-hi)] bg-[var(--bg-3)]" : "text-[var(--text-3)] hover:text-[var(--text-1)] hover:bg-[var(--bg-3)]"
      }`}
    >
      <Icon size={12} />
      {label && <span>{label}</span>}
    </button>
  );
}

export function ActionsBar({ content, onRegenerate, onThumbsUp, onThumbsDown, thumbsUp, thumbsDown, latencyMs, tokenCount }: Props) {
  const [copied, setCopied] = useState(false);
  const onCopy = async () => {
    try { await navigator.clipboard.writeText(content); setCopied(true); setTimeout(() => setCopied(false), 1500); }
    catch {}
  };
  const meterParts: string[] = [];
  if (latencyMs !== undefined) meterParts.push(`${(latencyMs / 1000).toFixed(1)}s`);
  if (tokenCount !== undefined) meterParts.push(`${tokenCount} tok`);
  const meter = meterParts.join(" · ");

  return (
    <div className="flex items-center gap-1 mt-1">
      <ActionBtn icon="Copy" label={copied ? "Copied" : "Copy"} onClick={onCopy} />
      <ActionBtn icon="Refresh" label="Regenerate" onClick={onRegenerate} />
      <ActionBtn icon="ThumbsUp" active={thumbsUp} onClick={onThumbsUp} />
      <ActionBtn icon="ThumbsDown" active={thumbsDown} onClick={onThumbsDown} />
      {meter && (
        <>
          <span className="w-px h-3 bg-[var(--line-2)] mx-1" />
          <span className="text-[11px] text-[var(--text-3)] font-mono">{meter}</span>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add components/chat/ActionsBar.tsx
git commit -m "feat(chat): ActionsBar with Copy/Regenerate/👍👎/latency·token meter"
```

---

### Task 5.8: AssistantBlock + UserBubble + Message wrapper

**Files:**
- Create: `components/chat/UserBubble.tsx`
- Create: `components/chat/AssistantBlock.tsx`
- Create: `components/chat/Message.tsx`

- [ ] **Step 1: Create `components/chat/UserBubble.tsx`**

```tsx
// components/chat/UserBubble.tsx
export function UserBubble({ content }: { content: string }) {
  return (
    <div className="flex justify-end gap-3 items-start animate-fadeUp">
      <div className="max-w-[min(720px,78%)] flex flex-col gap-2 items-end">
        <div
          className="px-4 py-2.5 text-sm leading-relaxed text-[var(--text-1)]"
          style={{
            background: "var(--bg-3)",
            border: "1px solid var(--line-2)",
            borderRadius: "14px 14px 4px 14px",
          }}
        >
          {content}
        </div>
      </div>
      <div
        className="w-7 h-7 shrink-0 rounded-md flex items-center justify-center text-[11px] font-semibold text-[var(--text-2)] mt-1"
        style={{ background: "var(--bg-3)", border: "1px solid var(--line-2)" }}
      >
        G
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create `components/chat/AssistantBlock.tsx`**

```tsx
// components/chat/AssistantBlock.tsx
"use client";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { SourceCitation } from "@/lib/conversation";
import { SourcesPanel } from "./SourcesPanel";
import { ActionsBar } from "./ActionsBar";
import { ThinkingDots } from "./ThinkingDots";

interface Props {
  content: string;
  streaming: boolean;
  sources?: SourceCitation[];
  showSources: boolean;
  thumbsUp?: boolean;
  thumbsDown?: boolean;
  latencyMs?: number;
  tokenCount?: number;
  onRegenerate: () => void;
  onThumbsUp: () => void;
  onThumbsDown: () => void;
}

export function AssistantBlock({
  content, streaming, sources, showSources,
  thumbsUp, thumbsDown, latencyMs, tokenCount,
  onRegenerate, onThumbsUp, onThumbsDown,
}: Props) {
  const sourceCount = sources?.length ?? 0;
  return (
    <div className="flex justify-start gap-3 items-start animate-fadeUp">
      <div
        className="w-7 h-7 shrink-0 rounded-md flex items-center justify-center mt-1"
        style={{
          background: "linear-gradient(135deg, oklch(0.45 0.13 245), oklch(0.30 0.10 250))",
          boxShadow: "0 0 0 1px var(--line-2), 0 4px 10px oklch(0.45 0.13 245 / 0.25)",
        }}
      >
        <div
          className="w-3 h-3 rounded-[3px]"
          style={{
            background: "linear-gradient(135deg, var(--text-1), oklch(0.85 0.05 245))",
            boxShadow: "0 0 8px rgba(255,255,255,0.4)",
          }}
        />
      </div>
      <div className="flex flex-col max-w-[min(720px,78%)] items-start gap-2">
        {!streaming && (
          <div className="flex items-center gap-1.5 text-[11px] text-[var(--text-3)] font-mono">
            <span className="text-[var(--text-1)] font-medium">bimmerllm</span>
            {showSources && sourceCount > 0 && <><span>·</span><span>{sourceCount} sources cited</span></>}
          </div>
        )}
        <div className="text-[var(--text-1)] py-0.5">
          {streaming && !content ? (
            <ThinkingDots />
          ) : (
            <div className="prose text-sm leading-relaxed">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
            </div>
          )}
        </div>
        {!streaming && content && showSources && sources && sources.length > 0 && (
          <SourcesPanel sources={sources} />
        )}
        {!streaming && content && (
          <ActionsBar
            content={content}
            onRegenerate={onRegenerate}
            onThumbsUp={onThumbsUp}
            onThumbsDown={onThumbsDown}
            thumbsUp={thumbsUp}
            thumbsDown={thumbsDown}
            latencyMs={latencyMs}
            tokenCount={tokenCount}
          />
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Create `components/chat/Message.tsx`**

```tsx
// components/chat/Message.tsx
"use client";
import type { Message as StoredMessage } from "@/lib/conversation";
import { UserBubble } from "./UserBubble";
import { AssistantBlock } from "./AssistantBlock";

interface Props {
  m: StoredMessage;
  streaming: boolean;
  showSources: boolean;
  onRegenerate: () => void;
  onThumbsUp: () => void;
  onThumbsDown: () => void;
}

export function Message({ m, streaming, showSources, onRegenerate, onThumbsUp, onThumbsDown }: Props) {
  if (m.role === "user") return <UserBubble content={m.content} />;
  return (
    <AssistantBlock
      content={m.content}
      streaming={streaming}
      sources={m.sources}
      showSources={showSources}
      thumbsUp={m.thumbsUp}
      thumbsDown={m.thumbsDown}
      latencyMs={m.latencyMs}
      tokenCount={m.tokenCount}
      onRegenerate={onRegenerate}
      onThumbsUp={onThumbsUp}
      onThumbsDown={onThumbsDown}
    />
  );
}
```

- [ ] **Step 4: Commit**

```bash
git add components/chat/UserBubble.tsx components/chat/AssistantBlock.tsx components/chat/Message.tsx
git commit -m "feat(chat): Message + UserBubble + AssistantBlock with sources/actions"
```

---

### Task 5.9: Thread

**Files:**
- Create: `components/chat/Thread.tsx`

- [ ] **Step 1: Create file**

```tsx
// components/chat/Thread.tsx
"use client";
import { useEffect, useRef } from "react";
import type { Message as StoredMessage } from "@/lib/conversation";
import { Message } from "./Message";

interface Props {
  messages: StoredMessage[];
  streaming: boolean;
  showSources: boolean;
  onRegenerate: () => void;
  onThumbsUp: (idx: number) => void;
  onThumbsDown: (idx: number) => void;
}

export function Thread({ messages, streaming, showSources, onRegenerate, onThumbsUp, onThumbsDown }: Props) {
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length, streaming]);

  return (
    <div className="max-w-[820px] mx-auto flex flex-col gap-5 pb-6">
      {messages.map((m, i) => {
        const isLastAssistant = m.role === "model" && i === messages.length - 1;
        return (
          <Message
            key={i}
            m={m}
            streaming={streaming && isLastAssistant}
            showSources={showSources}
            onRegenerate={onRegenerate}
            onThumbsUp={() => onThumbsUp(i)}
            onThumbsDown={() => onThumbsDown(i)}
          />
        );
      })}
      <div ref={endRef} className="h-[60px]" />
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add components/chat/Thread.tsx
git commit -m "feat(chat): Thread message list with auto-scroll"
```

---

### Task 5.10: Preferences read helper

**Files:**
- Create: `lib/preferences.ts`

- [ ] **Step 1: Create file**

```ts
// lib/preferences.ts
"use client";

export interface Preferences {
  units: "metric" | "imperial";
  citations: boolean;
  autoModel: boolean;
}

const KEY = "bimmerllm_prefs";
const DEFAULT: Preferences = { units: "metric", citations: true, autoModel: true };

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
```

- [ ] **Step 2: Commit**

```bash
git add lib/preferences.ts
git commit -m "feat(lib): Preferences read/write helpers"
```

---

### Task 5.11: ChatPage with useChat integration

**Files:**
- Create: `components/chat/ChatPage.tsx`

- [ ] **Step 1: Create file**

```tsx
// components/chat/ChatPage.tsx
"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useChat as useAiChat } from "@ai-sdk/react";
import { useChat as useChatStore } from "@/components/chat-provider";
import type { Message as StoredMessage } from "@/lib/conversation";
import { parseSourcesAnnotation } from "@/lib/sources";
import { readPreferences } from "@/lib/preferences";
import { Topbar } from "./Topbar";
import { Thread } from "./Thread";
import { Welcome } from "./Welcome";
import { Composer } from "./Composer";

const DISCLAIMER = "bimmerllm references bimmerpost community knowledge. Always verify critical procedures with your service manual.";

// Map storage role to AI SDK role
function toAiMessage(m: StoredMessage, idx: number): { id: string; role: "user" | "assistant"; parts: { type: "text"; text: string }[] } {
  return {
    id: `legacy-${idx}`,
    role: m.role === "model" ? "assistant" : "user",
    parts: [{ type: "text" as const, text: m.content }],
  };
}

interface AiUiMessage {
  id: string;
  role: "user" | "assistant" | "system";
  parts: { type: string; text?: string }[];
}

function fromAiMessage(m: AiUiMessage): StoredMessage {
  const text = m.parts.filter(p => p.type === "text").map(p => p.text ?? "").join("");
  return {
    role: m.role === "assistant" ? "model" : "user",
    content: text,
  };
}

export function ChatPage() {
  const {
    activeConversation,
    updateActiveConversation,
    togglePinned,
    setModel,
    setMessages: persistMessages,
  } = useChatStore();

  const [vehicleContext, setVehicleContext] = useState(activeConversation?.model ?? "Auto-detect");
  const [input, setInput] = useState("");
  const [showSources, setShowSources] = useState(true);
  const streamStartRef = useRef<number | null>(null);

  useEffect(() => {
    setShowSources(readPreferences().citations);
  }, []);

  useEffect(() => {
    setVehicleContext(activeConversation?.model ?? "Auto-detect");
  }, [activeConversation?.id, activeConversation?.model]);

  const initialMessages = useMemo(
    () => (activeConversation?.messages ?? []).map(toAiMessage),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activeConversation?.id]
  );

  const {
    messages: aiMessages,
    sendMessage,
    status,
    stop,
    regenerate,
  } = useAiChat({
    api: "/api/chat",
    initialMessages,
    body: { vehicleContext },
    onFinish: ({ message }) => {
      if (!activeConversation) return;
      const finishedAt = Date.now();
      const latencyMs = streamStartRef.current ? finishedAt - streamStartRef.current : undefined;
      streamStartRef.current = null;

      const stored = aiMessages.concat([message as AiUiMessage]).map(fromAiMessage);
      // Attach annotations from the finished assistant message
      const lastAi = message as AiUiMessage & { metadata?: unknown };
      const sources = parseSourcesAnnotation(extractSources(message)) ?? undefined;

      const lastIdx = stored.length - 1;
      if (stored[lastIdx]?.role === "model") {
        stored[lastIdx] = {
          ...stored[lastIdx],
          sources,
          latencyMs,
          tokenCount: Math.ceil(stored[lastIdx].content.length / 4),
        };
      }
      persistMessages(activeConversation.id, stored);
      // Title rule: derive from first user msg if still default
      if (activeConversation.title === "New consultation") {
        const firstUser = stored.find(m => m.role === "user");
        if (firstUser) {
          updateActiveConversation(c => ({ ...c, title: firstUser.content.slice(0, 50) }));
        }
      }
    },
  });

  const streaming = status === "streaming" || status === "submitted";

  const onSend = () => {
    if (!input.trim() || !activeConversation) return;
    streamStartRef.current = Date.now();
    sendMessage({ text: input });
    setInput("");
  };
  const onPick = (text: string) => {
    if (!activeConversation) return;
    streamStartRef.current = Date.now();
    sendMessage({ text });
  };

  const messages: StoredMessage[] = aiMessages.length > 0
    ? (aiMessages as AiUiMessage[]).map(fromAiMessage)
    : (activeConversation?.messages ?? []);
  const isEmpty = messages.length === 0;

  const onRegenerate = () => regenerate();
  const onThumbsUp = (idx: number) => {
    if (!activeConversation) return;
    persistMessages(activeConversation.id, messages.map((m, i) =>
      i === idx ? { ...m, thumbsUp: !m.thumbsUp, thumbsDown: false } : m
    ));
  };
  const onThumbsDown = (idx: number) => {
    if (!activeConversation) return;
    persistMessages(activeConversation.id, messages.map((m, i) =>
      i === idx ? { ...m, thumbsDown: !m.thumbsDown, thumbsUp: false } : m
    ));
  };

  const onModelChange = (v: string) => {
    setVehicleContext(v);
    if (activeConversation) setModel(activeConversation.id, v);
  };

  return (
    <div className="flex-1 flex flex-col h-full min-w-0">
      <Topbar
        title={activeConversation?.title ?? ""}
        isEmpty={isEmpty}
        vehicleContext={vehicleContext}
        setVehicleContext={onModelChange}
        onBookmark={() => activeConversation && togglePinned(activeConversation.id)}
        bookmarked={activeConversation?.pinned ?? false}
        onRegenerate={onRegenerate}
        canRegenerate={messages.some(m => m.role === "model")}
      />
      <div className="flex-1 overflow-y-auto px-8 pt-8 pb-2 scroll-smooth">
        {isEmpty
          ? <Welcome onPick={onPick} />
          : <Thread
              messages={messages}
              streaming={streaming}
              showSources={showSources}
              onRegenerate={onRegenerate}
              onThumbsUp={onThumbsUp}
              onThumbsDown={onThumbsDown}
            />
        }
      </div>
      <div className="shrink-0 px-6 pt-3 pb-4.5" style={{ background: "linear-gradient(180deg, transparent, var(--bg-1) 30%)" }}>
        <Composer
          value={input}
          onChange={setInput}
          onSend={onSend}
          onStop={stop}
          streaming={streaming}
          disabled={!activeConversation}
        />
        <p className="text-center text-[var(--text-3)] text-[11px] mt-2 max-w-[640px] mx-auto">{DISCLAIMER}</p>
      </div>
    </div>
  );
}

function extractSources(message: unknown): unknown {
  // The message may carry annotations or data parts depending on AI SDK v5 surface.
  // Try multiple shapes; return the first that looks like sources data.
  if (!message || typeof message !== "object") return null;
  const m = message as Record<string, unknown>;
  if (Array.isArray(m.annotations)) {
    for (const a of m.annotations) {
      const parsed = a && typeof a === "object" ? a : null;
      if (parsed && (parsed as Record<string, unknown>).type === "sources") return parsed;
    }
  }
  if (Array.isArray(m.parts)) {
    for (const p of m.parts) {
      const pp = p as Record<string, unknown>;
      if (pp.type === "data-sources") return pp.data;
    }
  }
  return null;
}
```

- [ ] **Step 2: Wire ChatPage into `app/(app)/page.tsx`** (replace temporary)

```tsx
// app/(app)/page.tsx
"use client";
import { useChat } from "@/components/chat-provider";
import { ChatPage } from "@/components/chat/ChatPage";

export default function Page() {
  const { activeConversation } = useChat();
  if (!activeConversation) return null;
  return <ChatPage key={activeConversation.id} />;
}
```

- [ ] **Step 3: Run typecheck**

Run: `npm run typecheck`
Expected: PASS. Type drift in `useAiChat` (the AI SDK v5 React hook) may need adjustment based on the actual `@ai-sdk/react` API surface. If `@ai-sdk/react` is not installed, run `npm install --legacy-peer-deps @ai-sdk/react`.

- [ ] **Step 4: Reload browser, smoke-test full chat flow**

Run: `cmux browser reload`. Then:
1. Welcome screen visible.
2. Click a suggested prompt → ThinkingDots appear → streaming text fills in → SourcesPanel shows N sources cited → ActionsBar shows latency·token.
3. Open `cmux browser console list` and `cmux browser errors list` — verify zero errors (excluding the AI SDK type warnings if any are tolerated by `next dev`).
4. Click thumbs-up → button highlights; reload page → still highlighted (persisted).
5. Click Bookmark on Topbar → sidebar moves the conversation to Pinned group.
6. Click Refresh → last assistant message regenerates.

- [ ] **Step 5: Commit**

```bash
git add components/chat/ChatPage.tsx app/\(app\)/page.tsx
git commit -m "feat(chat): ChatPage with useChat integration + sources + actions wired up"
```

---

## Phase 6 — Library page

### Task 6.1: LibraryHeader

**Files:**
- Create: `components/library/LibraryHeader.tsx`

- [ ] **Step 1: Create file**

```tsx
// components/library/LibraryHeader.tsx
"use client";
import { I } from "@/components/ui/icons";

interface Props {
  total: number;
  favorited: number;
  query: string;
  setQuery: (v: string) => void;
  view: "list" | "grid";
  setView: (v: "list" | "grid") => void;
}

export function LibraryHeader({ total, favorited, query, setQuery, view, setView }: Props) {
  return (
    <header className="px-10 pt-9 pb-6 border-b border-[var(--line-1)] flex justify-between items-end gap-6 flex-wrap">
      <div>
        <div className="font-mono text-[10.5px] text-[var(--text-3)] uppercase tracking-widest mb-2">Library</div>
        <h1 className="text-[28px] font-medium tracking-tight m-0 text-[var(--text-1)]">Consultation history</h1>
        <p className="text-[13px] text-[var(--text-3)] mt-2">{total} sessions · {favorited} favorited</p>
      </div>
      <div className="flex items-center gap-2.5">
        <div
          className="flex items-center gap-2 px-3 h-[34px] w-[240px] rounded-lg text-[var(--text-3)]"
          style={{ background: "var(--bg-2)", border: "1px solid var(--line-2)" }}
        >
          <I.Search size={13} />
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search consultations…"
            className="flex-1 bg-transparent border-0 outline-none text-[var(--text-1)] text-[12.5px]"
          />
        </div>
        <div className="flex p-0.5 rounded-lg" style={{ background: "var(--bg-2)", border: "1px solid var(--line-2)" }}>
          <button
            onClick={() => setView("list")}
            className={`w-7 h-7 flex items-center justify-center rounded-md ${view === "list" ? "bg-[var(--bg-3)] text-[var(--text-1)]" : "text-[var(--text-3)]"} cursor-pointer`}
            aria-label="List view"
          >
            <span className="flex flex-col gap-0.5"><span className="w-2.5 h-px bg-current" /><span className="w-2.5 h-px bg-current" /><span className="w-2.5 h-px bg-current" /></span>
          </button>
          <button
            onClick={() => setView("grid")}
            className={`w-7 h-7 flex items-center justify-center rounded-md ${view === "grid" ? "bg-[var(--bg-3)] text-[var(--text-1)]" : "text-[var(--text-3)]"} cursor-pointer`}
            aria-label="Grid view"
          >
            <span className="grid grid-cols-2 gap-0.5 w-2.5 h-2.5"><span className="bg-current" /><span className="bg-current" /><span className="bg-current" /><span className="bg-current" /></span>
          </button>
        </div>
      </div>
    </header>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add components/library/LibraryHeader.tsx
git commit -m "feat(library): LibraryHeader with search + list/grid toggle"
```

---

### Task 6.2: LibraryFilters

**Files:**
- Create: `components/library/LibraryFilters.tsx`

- [ ] **Step 1: Create file**

```tsx
// components/library/LibraryFilters.tsx
"use client";

export type Filter = "all" | "favorite" | "pinned" | "today";
export type Sort = "recent" | "alpha";

interface Props {
  filter: Filter;
  setFilter: (f: Filter) => void;
  sort: Sort;
  setSort: (s: Sort) => void;
  counts: { all: number; favorite: number; pinned: number; today: number };
}

const items: { id: Filter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "favorite", label: "Favorites" },
  { id: "pinned", label: "Pinned" },
  { id: "today", label: "Today" },
];

export function LibraryFilters({ filter, setFilter, sort, setSort, counts }: Props) {
  return (
    <div className="px-10 py-4 flex justify-between items-center border-b border-[var(--line-1)]">
      <div className="flex gap-1">
        {items.map(it => (
          <button
            key={it.id}
            onClick={() => setFilter(it.id)}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12.5px] font-medium cursor-pointer transition-colors border ${
              filter === it.id
                ? "bg-[var(--bg-3)] text-[var(--text-1)] border-[var(--line-2)]"
                : "bg-transparent text-[var(--text-3)] border-transparent hover:text-[var(--text-1)]"
            }`}
          >
            {it.label}
            <span className="font-mono text-[10px] px-1.5 rounded-full bg-[var(--bg-1)] text-[var(--text-3)]">
              {counts[it.id]}
            </span>
          </button>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <span className="text-[11px] text-[var(--text-3)] font-mono uppercase tracking-wider">Sort</span>
        <select
          value={sort}
          onChange={e => setSort(e.target.value as Sort)}
          className="bg-[var(--bg-3)] border border-[var(--line-2)] rounded-md text-[var(--text-1)] text-xs px-2.5 py-1 cursor-pointer outline-none"
        >
          <option value="recent">Most recent</option>
          <option value="alpha">A → Z</option>
        </select>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add components/library/LibraryFilters.tsx
git commit -m "feat(library): LibraryFilters pills + sort"
```

---

### Task 6.3: ListRow + ListView

**Files:**
- Create: `components/library/ListRow.tsx`
- Create: `components/library/ListView.tsx`

- [ ] **Step 1: Create `lib/format.ts`** (relative time helper)

```ts
// lib/format.ts
export function formatRelative(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  const diff = (now.getTime() - d.getTime()) / 1000;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)}d ago`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
```

- [ ] **Step 2: Create `components/library/ListRow.tsx`**

```tsx
// components/library/ListRow.tsx
"use client";
import { I } from "@/components/ui/icons";
import { type Conversation, derivePreview } from "@/lib/conversation";
import { formatRelative } from "@/lib/format";

export function ListRow({ c, onClick }: { c: Conversation; onClick: () => void }) {
  const preview = derivePreview(c.messages);
  const Icon = c.pinned ? I.Pin : c.favorite ? I.Star : I.Chat;
  return (
    <button
      onClick={onClick}
      className="grid items-center gap-4 px-4 py-4 cursor-pointer text-left text-[var(--text-1)] transition-colors border border-[var(--line-1)] -mb-px hover:bg-[var(--bg-3)] hover:border-[var(--line-2)]"
      style={{ gridTemplateColumns: "32px 1fr auto auto 18px" }}
    >
      <div
        className="w-8 h-8 rounded-md flex items-center justify-center"
        style={{ background: "var(--bg-3)", color: "var(--accent-hi)" }}
      >
        <Icon size={12} />
      </div>
      <div className="min-w-0 flex flex-col gap-0.5">
        <div className="text-[13.5px] font-medium text-[var(--text-1)] truncate">{c.title}</div>
        {preview && <div className="text-xs text-[var(--text-3)] truncate">{preview}</div>}
      </div>
      <div className="flex gap-1.5">
        {c.model && <span className="font-mono text-[11px] uppercase tracking-wider px-2 py-0.5 rounded-full bg-[var(--bg-3)] border border-[var(--line-2)] text-[var(--text-2)]">{c.model}</span>}
      </div>
      <div className="text-[11.5px] text-[var(--text-3)] font-mono whitespace-nowrap">{formatRelative(c.updatedAt)}</div>
      <div className="text-[var(--text-3)]"><I.ChevronRight size={13} /></div>
    </button>
  );
}
```

- [ ] **Step 3: Create `components/library/ListView.tsx`**

```tsx
// components/library/ListView.tsx
"use client";
import type { Conversation } from "@/lib/conversation";
import { ListRow } from "./ListRow";

export function ListView({ items, onOpen }: { items: Conversation[]; onOpen: (id: string) => void }) {
  return (
    <div className="flex flex-col">
      {items.map(c => <ListRow key={c.id} c={c} onClick={() => onOpen(c.id)} />)}
    </div>
  );
}
```

- [ ] **Step 4: Commit**

```bash
git add lib/format.ts components/library/ListRow.tsx components/library/ListView.tsx
git commit -m "feat(library): ListRow + ListView + formatRelative helper"
```

---

### Task 6.4: GridCard + GridView

**Files:**
- Create: `components/library/GridCard.tsx`
- Create: `components/library/GridView.tsx`

- [ ] **Step 1: Create `components/library/GridCard.tsx`**

```tsx
// components/library/GridCard.tsx
"use client";
import { I } from "@/components/ui/icons";
import { type Conversation, derivePreview } from "@/lib/conversation";
import { formatRelative } from "@/lib/format";

export function GridCard({ c, onClick }: { c: Conversation; onClick: () => void }) {
  const preview = derivePreview(c.messages);
  return (
    <button
      onClick={onClick}
      className="flex flex-col gap-2.5 p-4.5 rounded-xl text-left cursor-pointer transition-all min-h-[160px] bg-[var(--bg-3)] border border-[var(--line-2)] text-[var(--text-1)] hover:-translate-y-0.5 hover:border-[var(--line-3)]"
    >
      <div className="flex items-center gap-1.5 text-[var(--text-3)]">
        {c.model && <span className="font-mono text-[11px] uppercase tracking-wider px-2 py-0.5 rounded-full bg-[var(--bg-2)] border border-[var(--line-2)] text-[var(--text-2)]">{c.model}</span>}
        <span className="ml-auto flex gap-1">
          {c.pinned && <I.Pin size={11} />}
          {c.favorite && <span className="text-[var(--accent)]"><I.Star size={11} /></span>}
        </span>
      </div>
      <div className="text-[14.5px] font-medium tracking-tight leading-snug text-[var(--text-1)]">{c.title}</div>
      <div
        className="text-[12.5px] text-[var(--text-3)] leading-relaxed flex-1"
        style={{ display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical", overflow: "hidden" }}
      >
        {preview || "—"}
      </div>
      <div className="flex justify-between items-center pt-2 border-t border-[var(--line-1)] text-[var(--text-3)]">
        <span className="font-mono text-[10.5px]">{formatRelative(c.updatedAt)}</span>
        <I.ChevronRight size={13} />
      </div>
    </button>
  );
}
```

- [ ] **Step 2: Create `components/library/GridView.tsx`**

```tsx
// components/library/GridView.tsx
"use client";
import type { Conversation } from "@/lib/conversation";
import { GridCard } from "./GridCard";

export function GridView({ items, onOpen }: { items: Conversation[]; onOpen: (id: string) => void }) {
  return (
    <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))" }}>
      {items.map(c => <GridCard key={c.id} c={c} onClick={() => onOpen(c.id)} />)}
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add components/library/GridCard.tsx components/library/GridView.tsx
git commit -m "feat(library): GridCard + GridView"
```

---

### Task 6.5: LibraryPage composition + route

**Files:**
- Create: `components/library/LibraryPage.tsx`
- Create: `app/(app)/library/page.tsx`

- [ ] **Step 1: Create `components/library/LibraryPage.tsx`**

```tsx
// components/library/LibraryPage.tsx
"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useChat } from "@/components/chat-provider";
import { getBucket, derivePreview } from "@/lib/conversation";
import { LibraryHeader } from "./LibraryHeader";
import { LibraryFilters, type Filter, type Sort } from "./LibraryFilters";
import { ListView } from "./ListView";
import { GridView } from "./GridView";
import { I } from "@/components/ui/icons";

export function LibraryPage() {
  const router = useRouter();
  const { conversations, setActiveId } = useChat();
  const [filter, setFilter] = useState<Filter>("all");
  const [view, setView] = useState<"list" | "grid">("list");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<Sort>("recent");

  const counts = useMemo(() => ({
    all: conversations.length,
    favorite: conversations.filter(c => c.favorite).length,
    pinned: conversations.filter(c => c.pinned).length,
    today: conversations.filter(c => getBucket(c.updatedAt) === "today").length,
  }), [conversations]);

  const list = useMemo(() => {
    let xs = [...conversations];
    if (filter === "favorite") xs = xs.filter(c => c.favorite);
    if (filter === "pinned") xs = xs.filter(c => c.pinned);
    if (filter === "today") xs = xs.filter(c => getBucket(c.updatedAt) === "today");
    if (query) {
      const q = query.toLowerCase();
      xs = xs.filter(c =>
        (c.title + " " + derivePreview(c.messages) + " " + (c.model || "")).toLowerCase().includes(q)
      );
    }
    if (sort === "recent") xs.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
    if (sort === "alpha") xs.sort((a, b) => a.title.localeCompare(b.title));
    return xs;
  }, [conversations, filter, query, sort]);

  const open = (id: string) => { setActiveId(id); router.push("/"); };

  return (
    <div className="flex-1 h-full overflow-y-auto flex flex-col">
      <LibraryHeader
        total={counts.all}
        favorited={counts.favorite}
        query={query}
        setQuery={setQuery}
        view={view}
        setView={setView}
      />
      <LibraryFilters filter={filter} setFilter={setFilter} sort={sort} setSort={setSort} counts={counts} />
      <div className="px-10 py-6 pb-16">
        {list.length === 0 ? (
          <div className="py-20 flex flex-col items-center gap-3.5 text-[var(--text-3)] text-[13px]">
            <I.Search size={28} />
            <div>No consultations match.</div>
          </div>
        ) : view === "list" ? (
          <ListView items={list} onOpen={open} />
        ) : (
          <GridView items={list} onOpen={open} />
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create `app/(app)/library/page.tsx`**

```tsx
// app/(app)/library/page.tsx
import { LibraryPage } from "@/components/library/LibraryPage";
export default function Page() { return <LibraryPage />; }
```

- [ ] **Step 3: Verify in browser**

Run: `cmux browser goto http://localhost:3000/library`
Expected: Library header + filters + list of conversations rendered (or "No consultations match" empty state if storage is empty).

- [ ] **Step 4: Commit**

```bash
git add components/library/LibraryPage.tsx app/\(app\)/library/page.tsx
git commit -m "feat(library): LibraryPage composition + /library route"
```

---

## Phase 7 — Settings page

### Task 7.1: Toggle + Segment primitives

**Files:**
- Create: `components/settings/Toggle.tsx`
- Create: `components/settings/Segment.tsx`

- [ ] **Step 1: Create `components/settings/Toggle.tsx`**

```tsx
// components/settings/Toggle.tsx
"use client";
export function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!on)}
      role="switch"
      aria-checked={on}
      className="w-9 h-5 rounded-full border-0 p-0.5 cursor-pointer flex items-center transition-all"
      style={{
        background: on ? "var(--accent)" : "var(--bg-4)",
        justifyContent: on ? "flex-end" : "flex-start",
      }}
    >
      <span className="w-4 h-4 rounded-full transition-all" style={{ background: "#0A0A0F" }} />
    </button>
  );
}
```

- [ ] **Step 2: Create `components/settings/Segment.tsx`**

```tsx
// components/settings/Segment.tsx
"use client";

interface Props<T extends string> {
  value: T;
  onChange: (v: T) => void;
  options: { id: T; label: string }[];
}

export function Segment<T extends string>({ value, onChange, options }: Props<T>) {
  return (
    <div className="flex p-0.5 rounded-md" style={{ background: "var(--bg-2)", border: "1px solid var(--line-2)" }}>
      {options.map(o => (
        <button
          key={o.id}
          onClick={() => onChange(o.id)}
          className={`px-3.5 py-1 text-xs font-medium rounded-[5px] cursor-pointer ${
            value === o.id ? "text-[var(--text-1)]" : "text-[var(--text-3)]"
          }`}
          style={{ background: value === o.id ? "var(--bg-3)" : "transparent" }}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add components/settings/Toggle.tsx components/settings/Segment.tsx
git commit -m "feat(settings): Toggle + Segment primitives"
```

---

### Task 7.2: ThemeSwatch + AccentSwatch

**Files:**
- Create: `components/settings/ThemeSwatch.tsx`
- Create: `components/settings/AccentSwatch.tsx`

- [ ] **Step 1: Create `components/settings/ThemeSwatch.tsx`**

```tsx
// components/settings/ThemeSwatch.tsx
"use client";
import { I } from "@/components/ui/icons";
import type { Theme } from "@/lib/theme";

interface Props {
  id: Theme;
  label: string;
  from: string;
  to: string;
  active: boolean;
  onClick: () => void;
}

export function ThemeSwatch({ id: _id, label, from, to, active, onClick }: Props) {
  return (
    <button
      onClick={onClick}
      className="p-2.5 rounded-xl cursor-pointer flex flex-col gap-2 text-left"
      style={{
        background: "var(--bg-2)",
        border: `1px solid ${active ? "var(--accent)" : "var(--line-2)"}`,
      }}
    >
      <div
        className="h-16 rounded-md relative"
        style={{ background: `linear-gradient(135deg, ${from}, ${to})` }}
      >
        <div className="absolute inset-2 border border-white/10 rounded" />
      </div>
      <div className="flex justify-between items-center">
        <span className={`text-[12.5px] font-medium ${active ? "text-[var(--text-1)]" : "text-[var(--text-2)]"}`}>{label}</span>
        {active && <I.Check size={12} />}
      </div>
    </button>
  );
}
```

- [ ] **Step 2: Create `components/settings/AccentSwatch.tsx`**

```tsx
// components/settings/AccentSwatch.tsx
"use client";
import type { Accent } from "@/lib/theme";

export function AccentSwatch({ id: _id, swatch, active, onClick }: { id: Accent; swatch: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="w-9 h-9 rounded-full cursor-pointer p-0"
      style={{
        background: swatch,
        border: `2px solid ${active ? "var(--text-1)" : "transparent"}`,
        boxShadow: `0 4px 14px ${swatch}`,
      }}
      aria-label={`Accent ${_id}${active ? " (selected)" : ""}`}
    />
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add components/settings/ThemeSwatch.tsx components/settings/AccentSwatch.tsx
git commit -m "feat(settings): ThemeSwatch + AccentSwatch"
```

---

### Task 7.3: PreferencesSection + AppearanceSection

**Files:**
- Create: `components/settings/PreferencesSection.tsx`
- Create: `components/settings/AppearanceSection.tsx`

- [ ] **Step 1: Create `components/settings/PreferencesSection.tsx`**

```tsx
// components/settings/PreferencesSection.tsx
"use client";
import { useEffect, useState } from "react";
import { readPreferences, writePreferences, type Preferences } from "@/lib/preferences";
import { Toggle } from "./Toggle";
import { Segment } from "./Segment";

function Row({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between py-2.5 gap-4">
      <div className="flex-1 min-w-0">
        <div className="text-[13px] text-[var(--text-1)] font-medium">{title}</div>
        {sub && <div className="text-xs text-[var(--text-3)] mt-0.5">{sub}</div>}
      </div>
      {children}
    </div>
  );
}

function Divider() { return <div className="h-px bg-[var(--line-1)] -mx-5" />; }

export function PreferencesSection() {
  const [prefs, setPrefs] = useState<Preferences>(() => readPreferences());

  useEffect(() => { writePreferences(prefs); }, [prefs]);

  return (
    <div className="animate-fadeUp">
      <div className="flex justify-between items-end mb-4.5 gap-4">
        <div>
          <h2 className="text-lg font-medium tracking-tight m-0">Preferences</h2>
          <p className="text-[13px] text-[var(--text-3)] mt-1">How bimmerllm answers you.</p>
        </div>
      </div>
      <div className="rounded-2xl p-5" style={{ background: "var(--bg-3)", border: "1px solid var(--line-2)" }}>
        <Row title="Measurement units" sub="Used in torque specs, mileage, fluid volumes.">
          <Segment
            value={prefs.units}
            onChange={v => setPrefs({ ...prefs, units: v as Preferences["units"] })}
            options={[{ id: "metric", label: "Metric" }, { id: "imperial", label: "Imperial" }]}
          />
        </Row>
        <Divider />
        <Row title="Cite sources inline" sub="Show retrieved bimmerpost passages next to claims.">
          <Toggle on={prefs.citations} onChange={v => setPrefs({ ...prefs, citations: v })} />
        </Row>
        <Divider />
        <Row title="Auto-detect vehicle" sub="Infer the model from context if you don't pick one.">
          <Toggle on={prefs.autoModel} onChange={v => setPrefs({ ...prefs, autoModel: v })} />
        </Row>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create `components/settings/AppearanceSection.tsx`**

```tsx
// components/settings/AppearanceSection.tsx
"use client";
import { useEffect, useState } from "react";
import {
  THEMES, ACCENTS,
  applyTheme, applyAccent,
  getStoredTheme, getStoredAccent,
  type Theme, type Accent,
} from "@/lib/theme";
import { ThemeSwatch } from "./ThemeSwatch";
import { AccentSwatch } from "./AccentSwatch";

export function AppearanceSection() {
  const [theme, setTheme] = useState<Theme>("midnight");
  const [accent, setAccent] = useState<Accent>("blue");

  useEffect(() => { setTheme(getStoredTheme()); setAccent(getStoredAccent()); }, []);

  const onTheme = (t: Theme) => { setTheme(t); applyTheme(t); };
  const onAccent = (a: Accent) => { setAccent(a); applyAccent(a); };

  return (
    <div className="animate-fadeUp">
      <div className="flex justify-between items-end mb-4.5 gap-4">
        <div>
          <h2 className="text-lg font-medium tracking-tight m-0">Appearance</h2>
          <p className="text-[13px] text-[var(--text-3)] mt-1">Color & material.</p>
        </div>
      </div>
      <div className="rounded-2xl p-5" style={{ background: "var(--bg-3)", border: "1px solid var(--line-2)" }}>
        <div className="text-xs font-semibold text-[var(--text-3)] uppercase tracking-wider font-mono mb-3">Theme</div>
        <div className="grid grid-cols-3 gap-2.5">
          {THEMES.map(t => (
            <ThemeSwatch key={t.id} id={t.id} label={t.label} from={t.from} to={t.to} active={theme === t.id} onClick={() => onTheme(t.id)} />
          ))}
        </div>
        <div className="h-5" />
        <div className="text-xs font-semibold text-[var(--text-3)] uppercase tracking-wider font-mono mb-3">Accent</div>
        <div className="flex gap-2.5">
          {ACCENTS.map(a => (
            <AccentSwatch key={a.id} id={a.id} swatch={a.swatch} active={accent === a.id} onClick={() => onAccent(a.id)} />
          ))}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add components/settings/PreferencesSection.tsx components/settings/AppearanceSection.tsx
git commit -m "feat(settings): Preferences + Appearance sections with live-flip"
```

---

### Task 7.4: SettingsPage + route

**Files:**
- Create: `components/settings/SettingsPage.tsx`
- Create: `app/(app)/settings/page.tsx`

- [ ] **Step 1: Create `components/settings/SettingsPage.tsx`**

```tsx
// components/settings/SettingsPage.tsx
"use client";
import { useState } from "react";
import { I } from "@/components/ui/icons";
import { PreferencesSection } from "./PreferencesSection";
import { AppearanceSection } from "./AppearanceSection";

const SECTIONS = [
  { id: "preferences", label: "Preferences", icon: I.Settings },
  { id: "appearance", label: "Appearance", icon: I.Sparkle },
] as const;

type SectionId = typeof SECTIONS[number]["id"];

export function SettingsPage() {
  const [section, setSection] = useState<SectionId>("preferences");
  return (
    <div className="flex-1 h-full overflow-y-auto">
      <header className="px-10 pt-9 pb-6 border-b border-[var(--line-1)]">
        <div className="font-mono text-[10.5px] text-[var(--text-3)] uppercase tracking-widest mb-2">Account</div>
        <h1 className="text-[28px] font-medium tracking-tight m-0">Settings</h1>
      </header>
      <div
        className="grid max-w-[1080px] mx-auto gap-10 px-10 pt-7 pb-20"
        style={{ gridTemplateColumns: "200px 1fr" }}
      >
        <nav className="flex flex-col gap-px sticky top-7 self-start h-fit">
          {SECTIONS.map(s => {
            const Icon = s.icon;
            const active = section === s.id;
            return (
              <button
                key={s.id}
                onClick={() => setSection(s.id)}
                className={`flex items-center gap-2.5 px-3 py-2 rounded-md text-[13px] font-normal cursor-pointer text-left transition-colors ${
                  active ? "bg-[var(--bg-3)] text-[var(--text-1)]" : "text-[var(--text-2)] hover:bg-[var(--bg-3)]"
                }`}
              >
                <Icon size={14} />
                <span>{s.label}</span>
                {active && <I.ChevronRight size={12} className="ml-auto" />}
              </button>
            );
          })}
        </nav>
        <div className="min-w-0">
          {section === "preferences" && <PreferencesSection />}
          {section === "appearance" && <AppearanceSection />}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create `app/(app)/settings/page.tsx`**

```tsx
// app/(app)/settings/page.tsx
import { SettingsPage } from "@/components/settings/SettingsPage";
export default function Page() { return <SettingsPage />; }
```

- [ ] **Step 3: Verify in browser**

Run: `cmux browser goto http://localhost:3000/settings`
Expected:
1. Settings page renders with Preferences active and Appearance switchable in left nav.
2. Click Appearance → click Graphite theme swatch → entire UI background flips to graphite tones instantly.
3. Click ember accent → button highlights and primary color changes site-wide instantly.
4. Reload page → theme + accent persist.

- [ ] **Step 4: Commit**

```bash
git add components/settings/SettingsPage.tsx app/\(app\)/settings/page.tsx
git commit -m "feat(settings): SettingsPage with Preferences + Appearance + /settings route"
```

---

## Phase 8 — Cleanup + verification

### Task 8.1: Delete dead code

**Files:**
- Delete: `lib/agent.ts`
- Delete: `lib/pinecone.ts`
- Delete: `components/app-sidebar.tsx`
- Conditionally delete: `hooks/use-mobile.ts`

- [ ] **Step 1: Verify no consumers of `hooks/use-mobile.ts`**

```bash
grep -rn "use-mobile\|useIsMobile\|useMobile" components app lib 2>&1 | grep -v hooks/use-mobile
```

If empty, delete it. Otherwise keep.

- [ ] **Step 2: Delete files**

```bash
git rm lib/agent.ts lib/pinecone.ts components/app-sidebar.tsx
# only if no consumers:
git rm hooks/use-mobile.ts
rmdir hooks 2>/dev/null || true
```

- [ ] **Step 3: Run typecheck + lint**

```bash
npm run typecheck && npm run lint
```

Expected: Both PASS. Fix any new errors (likely just dangling imports of deleted files).

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore: remove dead helpers (lib/agent.ts, lib/pinecone.ts, app-sidebar.tsx)"
```

---

### Task 8.2: Drop deprecated dependencies

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Verify no consumers of `langchain` and `@langchain/openai`**

```bash
grep -rn "from [\"']langchain[\"']\|from [\"']@langchain/openai[\"']" app components lib 2>&1 | head
```

If empty (it should be — `lib/agent.ts` was the only consumer), proceed.

- [ ] **Step 2: Remove packages**

```bash
npm uninstall --legacy-peer-deps langchain @langchain/openai
```

- [ ] **Step 3: Run typecheck + lint + tests**

```bash
npm run typecheck && npm run lint && npm test
```

Expected: All PASS.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore(deps): drop unused langchain + @langchain/openai"
```

---

### Task 8.3: End-to-end manual smoke

- [ ] **Step 1: Restart dev server**

If dev server has been hot-reloading throughout, kill it and restart cleanly:

```bash
# kill the dev server background task, then:
npm run dev
```

Wait for `Ready in <ms>`.

- [ ] **Step 2: Browser smoke — Chat happy path**

Run: `cmux browser goto http://localhost:3000` then `cmux browser reload`

Acceptance:
- Welcome screen renders, no console/errors.
- Click suggested prompt "Diagnose a fault" → ThinkingDots → text streams → SourcesPanel "N sources cited" appears below the message → expand it → preview text shows.
- ActionsBar shows latency (e.g. `12.5s`) and token estimate.
- Click Copy → "Copied" indicator briefly shows.
- Click Refresh on Topbar → assistant message regenerates (new latency, possibly new content).
- Send second user message → new round trip works; previous messages remain.

- [ ] **Step 3: Browser smoke — Sidebar**

- New conversation via `⌘N` → URL stays `/`, fresh empty Chat opens, threads sidebar shows new conv at top.
- Search box filters threads.
- Click Bookmark on Topbar → conversation moves to Pinned group in sidebar.

- [ ] **Step 4: Browser smoke — Library**

Run: `cmux browser goto http://localhost:3000/library`

- Header shows session count + favorited count.
- Filter pills work (All / Favorites / Pinned / Today).
- View toggle list ↔ grid works.
- Click a card / row → opens that conversation in `/`.

- [ ] **Step 5: Browser smoke — Settings**

Run: `cmux browser goto http://localhost:3000/settings`

- Preferences toggles persist on reload.
- Toggling "Cite sources inline" off → return to `/` → assistant messages no longer show SourcesPanel.
- Appearance: each theme swatch flips entire UI. Each accent swatch flips primary color. Reload preserves.

- [ ] **Step 6: Browser smoke — mobile sheet**

Run: `cmux browser eval --script 'window.innerWidth'` to see actual width. If desktop:

```bash
# resize via window — cmux browser may not support viewport mgmt; manual check via Chrome DevTools recommended.
# At minimum, confirm at <768px the sidebar is hidden (md:flex breakpoint).
```

V1 acceptance: sidebar hides cleanly under 768px. Mobile sheet drawer trigger is NOT required for V1.

- [ ] **Step 7: Run full check suite**

```bash
npm run typecheck && npm run lint && npm test
```

Expected: All PASS.

- [ ] **Step 8: Commit verification log**

No code change here; just close out:

```bash
git log --oneline -30
```

Expected: Clean linear history of feature commits since `cc902ec` (the spec commit).

---

## Self-review

The plan covers every section of the spec:

| Spec section | Covered by |
|---|---|
| Goals | Phases 1–7 |
| Non-goals | Explicit in spec; plan does not introduce them |
| Architecture | Phase 1.3 (route group), Phase 4 (backend), Phase 5 (ChatPage useChat) |
| File map: new files | Tasks 2.2 (conversation.ts), 2.4 (sources.ts), 2.5 (theme.ts), 4.2 (ai/google.ts + ai/pinecone.ts), 5.10 (preferences.ts), 6.3 (format.ts), Phase 3 (sidebar/), Phase 5 (chat/), Phase 6 (library/), Phase 7 (settings/), Phase 5/6 (page routes), Task 3.2 (icons.tsx) |
| File map: rewritten | Task 4.3 (api/chat/route.ts) |
| File map: modified | Task 1.1 (layout.tsx), 1.2 (globals.css), 2.6 (chat-provider.tsx), 4.1 + 8.2 (package.json) |
| File map: deleted | Task 1.3 (page.tsx), 8.1 (agent/pinecone/app-sidebar/use-mobile) |
| Routing | Tasks 1.3, 5.11, 6.5, 7.4 |
| Backend 5-step pipeline | Task 4.3 |
| Sources annotation wire format | Task 4.3 (with documented fallbacks for AI SDK quirks) |
| Vehicle context injection | Task 4.3 (in `reformulate` and `system` prompt) |
| Error handling | Task 4.3 (Pinecone fallback, reformulate fallback, generate `onError`) |
| Conversation/Message/SourceCitation types | Task 2.2 |
| Role mapping at boundary | Task 5.11 (`toAiMessage`/`fromAiMessage`) |
| Switching active conversation via `key={id}` | Task 5.11 (in `app/(app)/page.tsx`) |
| LocalStorage keys + migration | Tasks 2.2 + 2.6 + 5.10 + 7.3 |
| Theme/accent system + FOUC script | Tasks 1.1 + 1.2 + 2.5 + 7.3 |
| Tokens (mockup → globals.css) | Task 1.2 |
| shadcn retheme map | Task 1.2 |
| Inline-style retention | Task 1.2 (body::before), Task 3.1 (Brand), Task 5.8 (AssistantBlock mark), Task 7.2 (ThemeSwatch / AccentSwatch), Task 5.1 (Composer pill shadow) |
| Sidebar behaviors (groups, ⌘N, footer Guest) | Phase 3 |
| ChatPage behaviors (Welcome no-name, Thread, sources, actions, latency/token) | Phase 5 |
| LibraryPage (preview from messages, filter pills, sort, list/grid) | Phase 6 |
| SettingsPage (Prefs + Appearance only, sticky 200px nav) | Phase 7 |
| Vitest tests (conversation + sources) | Tasks 2.2 + 2.3 + 2.4 |
| Manual cmux browser verification | Task 8.3 |
| Implementation order | Phases 1–8 mirror spec's order |
| Risks (writeMessageAnnotation timing fallback, langchain peer dep, role map, shadcn primitive retheme) | Acknowledged in Tasks 4.3, 4.1, 5.11; documented inline |

Placeholder scan: 0 occurrences of TBD/TODO/FIXME/etc. Every step contains either complete code, a precise file move/delete command, or a verifiable cmux/curl invocation.

Type consistency: `Conversation`, `Message`, `StorageRole`, `SourceCitation` defined once in `lib/conversation.ts` (Task 2.2) and consistently imported across `lib/sources.ts`, `chat-provider.tsx`, `chat/*`, `library/*`. `Theme`/`Accent` defined once in `lib/theme.ts` (Task 2.5). `Preferences` defined once in `lib/preferences.ts` (Task 5.10). `Filter`/`Sort` defined once in `LibraryFilters.tsx` (Task 6.2).

Function signature stability: `migrateConversation(raw: unknown): Conversation | null`, `getBucket(updatedAt: string, now?: Date): Bucket`, `derivePreview(messages: Message[]): string`, `parseSourcesAnnotation(raw: unknown): SourceCitation[] | null`, `applyTheme(t: Theme): void`, `applyAccent(a: Accent): void` — all consistent.

If `useAiChat` from `@ai-sdk/react` differs from the assumed surface (e.g., `regenerate` is called `reload`, `status` values differ, `sendMessage` accepts different arg shape), the implementer is expected to adapt while preserving the spec contract: streaming, sources annotation reading, and onFinish persistence.
