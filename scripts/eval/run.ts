#!/usr/bin/env tsx
/**
 * RAG eval harness — Phase 2 gate.
 *
 * Loads docs/superpowers/eval/rag-eval.json, runs each retrieve config
 * (v1, v2-dense, v2-hybrid) against every question, prints recall@5 /
 * mrr@10 / latency table.
 *
 * Usage:
 *   npx tsx scripts/eval/run.ts                  # all configs
 *   npx tsx scripts/eval/run.ts --configs=v1     # comma-separated
 *   npx tsx scripts/eval/run.ts --top-k=10       # override default 10
 *
 * Phase 2 ships only when v2-hybrid+rerank beats v1 on both recall@5 and
 * mrr@10 by ≥10 percentage points. See docs/superpowers/specs/2026-05-05-
 * rag-phase2-design.md for context.
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

// Load .env.local before importing the route module so PINECONE_API_KEY +
// flags are populated. Tiny inline loader to avoid pulling dotenv just for
// this script. Lines like `KEY=value` populate process.env if not already
// set (so command-line overrides win).
function loadEnvLocal() {
  const p = resolve(process.cwd(), ".env.local");
  if (!existsSync(p)) return;
  for (const raw of readFileSync(p, "utf-8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const k = line.slice(0, eq).trim();
    let v = line.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (process.env[k] === undefined) process.env[k] = v;
  }
}
loadEnvLocal();

// We import the retrieve fns directly. These read the BIMMERPOST_* env vars
// at call time via the helper modules, so per-config overrides below work.
import {
  retrieveV1,
  retrieveV2Dense,
  retrieveV2Hybrid,
} from "../../app/api/chat/route";

interface EvalQuestion {
  id: string;
  query: string;
  expected_thread_ids: number[];
  category?: string;
  language?: string;
  vehicle_context?: string;
}

interface EvalSet {
  questions: EvalQuestion[];
}

interface ConfigResult {
  name: string;
  recallAt5: number;
  mrrAt10: number;
  latencyP50: number;
  latencyP95: number;
  skipped: number;          // questions with no expected_thread_ids
  failed: number;           // retrieve threw
  perQuestion: Array<{
    qid: string;
    rank: number | null;     // 1-indexed rank of first expected, null if miss
    latencyMs: number;
  }>;
}

type RetrieveFn = (q: string) => Promise<Array<{ id: string; threadId?: number }>>;

function parseArgs(argv: string[]): { configs: string[]; topK: number; sqlitePath: string } {
  const configs = new Set(["v1", "v2-dense", "v2-hybrid"]);
  let topK = 10;
  let sqlitePath = "scripts/ingest/data/ingest.db";
  for (const a of argv.slice(2)) {
    if (a.startsWith("--configs=")) {
      const v = a.slice("--configs=".length);
      configs.clear();
      v.split(",").map(s => s.trim()).filter(Boolean).forEach(s => configs.add(s));
    } else if (a.startsWith("--top-k=")) {
      topK = parseInt(a.slice("--top-k=".length), 10);
    } else if (a.startsWith("--sqlite=")) {
      sqlitePath = a.slice("--sqlite=".length);
    }
  }
  return { configs: Array.from(configs), topK, sqlitePath };
}

// v1 hits expose a UUID (`_id`) but not the original thread_id. We build a
// uuid → thread_id map at startup from the local ingest sqlite so v1 eval
// can use the same expected_thread_ids as v2. Optional: if sqlite isn't
// reachable we just skip v1 mapping and v1 hits won't match.
let _uuidToThreadId: Map<string, number> | null = null;
async function buildUuidMap(dbPath: string): Promise<Map<string, number>> {
  if (_uuidToThreadId) return _uuidToThreadId;
  if (!existsSync(dbPath)) {
    console.warn(`[eval] sqlite at ${dbPath} not found — v1 hits won't translate to thread_ids`);
    _uuidToThreadId = new Map();
    return _uuidToThreadId;
  }
  // node:sqlite is built into Node 22.5+ but @types/node may not include it
  // depending on the version pinned. Cast at the import boundary so the rest
  // of the script stays statically typed.
  // @ts-expect-error -- Node built-in module not yet in @types/node
  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(dbPath, { readOnly: true });
  const rows = db
    .prepare("SELECT thread_id, uuid FROM threads WHERE uuid IS NOT NULL")
    .all() as Array<{ thread_id: number; uuid: string }>;
  db.close();
  _uuidToThreadId = new Map(rows.map(r => [r.uuid, r.thread_id]));
  return _uuidToThreadId;
}

async function evalConfig(
  name: string,
  retrieveFn: RetrieveFn,
  questions: EvalQuestion[],
  topK: number,
): Promise<ConfigResult> {
  const perQuestion: ConfigResult["perQuestion"] = [];
  const latencies: number[] = [];
  let skipped = 0;
  let failed = 0;
  let hitsAt5 = 0;
  let mrrSum = 0;
  let scored = 0;

  for (const q of questions) {
    if (q.expected_thread_ids.length === 0) {
      skipped += 1;
      perQuestion.push({ qid: q.id, rank: null, latencyMs: 0 });
      continue;
    }
    const start = performance.now();
    let hits: Array<{ id: string; threadId?: number }>;
    try {
      hits = await retrieveFn(q.query);
    } catch (err) {
      failed += 1;
      console.error(`[${name}] ${q.id} threw:`, err);
      perQuestion.push({ qid: q.id, rank: null, latencyMs: 0 });
      continue;
    }
    const latency = performance.now() - start;
    latencies.push(latency);

    let firstRank: number | null = null;
    const expected = new Set(q.expected_thread_ids);
    const uuidMap = _uuidToThreadId ?? new Map<string, number>();
    for (let i = 0; i < Math.min(hits.length, topK); i++) {
      const h = hits[i];
      // v2 hits carry threadId in metadata; v1 hits expose a UUID and we
      // look up thread_id from the local ingest sqlite via uuidMap.
      let tid = h.threadId;
      if (tid === undefined) tid = uuidMap.get(h.id);
      if (tid !== undefined && expected.has(tid)) {
        firstRank = i + 1;
        break;
      }
    }
    perQuestion.push({ qid: q.id, rank: firstRank, latencyMs: latency });
    scored += 1;
    if (firstRank !== null && firstRank <= 5) hitsAt5 += 1;
    if (firstRank !== null) mrrSum += 1 / firstRank;
  }

  latencies.sort((a, b) => a - b);
  const pct = (p: number) =>
    latencies.length === 0 ? 0 : latencies[Math.min(latencies.length - 1, Math.floor(p * latencies.length))];

  return {
    name,
    recallAt5: scored === 0 ? 0 : hitsAt5 / scored,
    mrrAt10: scored === 0 ? 0 : mrrSum / scored,
    latencyP50: pct(0.5),
    latencyP95: pct(0.95),
    skipped,
    failed,
    perQuestion,
  };
}

function fmt(n: number, pct = false): string {
  if (pct) return `${(n * 100).toFixed(1)}%`;
  return `${n.toFixed(0)}ms`;
}

function printTable(results: ConfigResult[], total: number) {
  console.log("\n" + "═".repeat(78));
  console.log(
    `${"config".padEnd(18)}${"recall@5".padEnd(12)}${"mrr@10".padEnd(12)}` +
    `${"p50".padEnd(10)}${"p95".padEnd(10)}${"skipped".padEnd(10)}${"failed".padEnd(8)}`
  );
  console.log("─".repeat(78));
  for (const r of results) {
    console.log(
      `${r.name.padEnd(18)}${fmt(r.recallAt5, true).padEnd(12)}` +
      `${fmt(r.mrrAt10, true).padEnd(12)}${fmt(r.latencyP50).padEnd(10)}` +
      `${fmt(r.latencyP95).padEnd(10)}${String(r.skipped).padEnd(10)}` +
      `${String(r.failed).padEnd(8)}`
    );
  }
  console.log("─".repeat(78));
  console.log(`(${total} questions; skipped = expected_thread_ids empty; failed = retrieve threw)`);
}

async function main() {
  const { configs, topK, sqlitePath } = parseArgs(process.argv);
  const evalPath = resolve(process.cwd(), "docs/superpowers/eval/rag-eval.json");
  const set = JSON.parse(readFileSync(evalPath, "utf-8")) as EvalSet;
  const populated = set.questions.filter(q => q.expected_thread_ids.length > 0);

  console.log(`loaded ${set.questions.length} questions (${populated.length} with ground truth)`);
  console.log(`running configs: ${configs.join(", ")} (top-k = ${topK})`);

  // Build the v1 uuid → thread_id map once. v2 hits carry threadId natively.
  if (configs.includes("v1")) {
    const map = await buildUuidMap(resolve(process.cwd(), sqlitePath));
    console.log(`uuid → thread_id map: ${map.size} entries (from ${sqlitePath})`);
  }

  if (populated.length === 0) {
    console.warn(
      "\nNo question has expected_thread_ids populated yet — see " +
      "docs/superpowers/eval/rag-eval.json _format.instructions before " +
      "treating these numbers as meaningful."
    );
  }

  const fns: Record<string, RetrieveFn> = {
    v1: retrieveV1 as unknown as RetrieveFn,
    "v2-dense": retrieveV2Dense as unknown as RetrieveFn,
    "v2-hybrid": retrieveV2Hybrid as unknown as RetrieveFn,
  };

  const results: ConfigResult[] = [];
  for (const cfg of configs) {
    const fn = fns[cfg];
    if (!fn) {
      console.warn(`unknown config '${cfg}', skipping`);
      continue;
    }
    console.log(`\n→ ${cfg} ...`);
    results.push(await evalConfig(cfg, fn, set.questions, topK));
  }

  printTable(results, set.questions.length);

  // Phase 2 gate: hybrid must beat v1 by ≥10pp on both recall@5 and mrr@10.
  const v1 = results.find(r => r.name === "v1");
  const hyb = results.find(r => r.name === "v2-hybrid");
  if (v1 && hyb) {
    const dRecall = (hyb.recallAt5 - v1.recallAt5) * 100;
    const dMrr = (hyb.mrrAt10 - v1.mrrAt10) * 100;
    console.log(
      `\nPhase 2 gate: Δrecall@5 = ${dRecall.toFixed(1)}pp, ` +
      `Δmrr@10 = ${dMrr.toFixed(1)}pp; ship if both ≥ +10pp.`
    );
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
