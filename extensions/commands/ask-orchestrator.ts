/**
 * Orchestration logic for the /ask command — the research loop, URL fetching,
 * citation resolution, and atomic note creation.
 *
 * Separated from ask.ts to stay under the 300-line limit per file.
 *
 * @module extensions/commands/ask-orchestrator
 */

import { resolve } from "node:path";

import { complete } from "@earendil-works/pi-ai";

import {
  evaluateAndPlan,
  planNextRound,
  synthesizeAnswer,
  type SynthesisResult,
} from "./ask-helpers.js";
import { resolveCitation } from "../../common/citation.js";
import { createDocument } from "../../common/createDocument.js";
import { configureEnv, getKnowledgeConfig } from "../../common/env.js";
import { fetchUrlWithTimeout } from "../../common/fetchUrl.js";
import { searchWeb } from "../../common/webSearch.js";
import { createDb, initDb, searchDocs } from "../para-knowledge/db-sqlite.js";

// ── Constants ───────────────────────────────────────────────────────

const MAX_SEARCH_ROUNDS = 2;

/** Timeout per URL fetch in ms. */
const URL_FETCH_TIMEOUT_MS = 10_000;

// ── Helpers ─────────────────────────────────────────────────────────

/**
 * Create an atomic knowledge note from LLM-chosen title, tags, and body.
 *
 * @param body   - Synthesis body with contextual @citekey citations.
 * @param title  - LLM-chosen document title (used for filename slug).
 * @param tags   - LLM-chosen tags (preferring existing tags).
 * @param cwd    - Working directory for env resolution.
 * @returns Relative path to the created document, or null on failure.
 */
async function createAtomicNote(
  body: string,
  title: string,
  tags: string[],
  cwd: string,
): Promise<string | null> {
  try {
    const doc = await createDocument(
      {
        title,
        content: body,
        tags,
        area: "Resources",
        description: `Research synthesis: ${title}`,
      },
      { cwd },
    );
    return doc.path;
  } catch {
    return null;
  }
}

/**
 * Run the iterative web search loop with parallel URL fetching.
 *
 * Up to MAX_SEARCH_ROUNDS (2) rounds:
 * 1. planNextRound → generates queries and decides if done
 * 2. For each query: searchWeb(tier=3) with multisource fallback
 * 3. Collect unique URLs, fetch in parallel with 10s timeout
 * 4. Resolve citations in parallel
 * 5. If plan says done → exit loop
 *
 * @returns SynthesisResult with LLM-chosen title, tags, and body.
 */
export async function runWebSearchLoop(
  question: string,
  paraResults: Array<{ title: string; path: string; snippet: string }>,
  llmOpts: {
    model: Parameters<typeof complete>[0];
    apiKey: string;
    headers?: Record<string, string>;
    signal?: AbortSignal;
  },
  cwd: string,
  notify?: (msg: string) => void,
  existingTags?: string[],
): Promise<SynthesisResult> {
  const webSources: Array<{
    title: string;
    content: string;
    citekey: string | null;
    url: string;
    excerpt: string;
  }> = [];

  for (let round = 0; round < MAX_SEARCH_ROUNDS; round++) {
    notify?.(`Searching the web (round ${round + 1}/${MAX_SEARCH_ROUNDS})...`);

    // ── Decide what to search and if we're done ──
    const roundPlan = await planNextRound(question, webSources, round, llmOpts);
    if (roundPlan.done || roundPlan.queries.length === 0) break;

    // ── Web search for all queries ──
    const allUrls: Array<{ url: string; title: string }> = [];
    for (const q of roundPlan.queries) {
      const webResults = await searchWeb(q, { tier: 3, signal: llmOpts.signal });
      for (const r of webResults.results.slice(0, 3)) {
        if (!allUrls.some((u) => u.url === r.url)) {
          allUrls.push({ url: r.url, title: r.title });
        }
      }
    }

    if (allUrls.length === 0) continue;

    // ── Parallel URL fetching with timeout ──
    notify?.(`Fetching ${allUrls.length} page(s)...`);
    const fetchResults = await Promise.all(
      allUrls.map((entry) =>
        fetchUrlWithTimeout(entry.url, URL_FETCH_TIMEOUT_MS, llmOpts.signal).then((content) => ({
          entry,
          content,
        })),
      ),
    );

    // ── Parallel citation resolution (only for successful fetches) ──
    const resolved = await Promise.all(
      fetchResults
        .filter(
          (
            r,
          ): r is {
            entry: (typeof allUrls)[0];
            content: { title: string; content: string; engine: string };
          } => "content" in r.content && typeof r.content.content === "string",
        )
        .map(async (r) => {
          const citation = await resolveCitation(
            { source: r.entry.url, title: r.content.title },
            { cwd },
          ).catch(() => ({ citekey: null }));
          return {
            title: r.content.title,
            content: r.content.content,
            citekey: citation.citekey,
            url: r.entry.url,
            excerpt: r.content.content.slice(0, 300),
          };
        }),
    );
    webSources.push(...resolved);
  }

  // ── Combine PARA + web sources ──
  const allSources = [
    ...paraResults.map((r) => ({ title: r.title, content: r.snippet, citekey: null })),
    ...webSources.map((s) => ({ title: s.title, content: s.content, citekey: s.citekey })),
  ];

  notify?.("Synthesizing answer...");
  return await synthesizeAnswer(question, allSources, llmOpts, existingTags);
}

/**
 * Execute the optimized research loop.
 *
 * 1. Search PARA docs with the raw question
 * 2. evaluateAndPlan — merge eval + query gen in one LLM call
 * 3. Fast path: if docs sufficient, synthesize from docs immediately
 * 4. Slow path: parallel web search rounds with planNextRound gate
 *
 * @param question   - The user's question.
 * @param llmOpts    - LLM model configuration.
 * @param cwd        - Working directory for env resolution.
 * @param notify     - Optional callback for phase progress notifications.
 * @returns Synthesis text and optional document path.
 */
export async function executeResearchLoop(
  question: string,
  llmOpts: {
    model: Parameters<typeof complete>[0];
    apiKey: string;
    headers?: Record<string, string>;
    signal?: AbortSignal;
  },
  cwd: string,
  notify?: (msg: string) => void,
): Promise<{ synthesis: string; docPath: string | null }> {
  configureEnv(cwd);
  const { dir, db: dbName } = getKnowledgeConfig(cwd);
  const db = createDb(resolve(dir, dbName));
  initDb(db);

  // ── Query existing tags for the synthesis LLM context ──
  const existingTags = db
    .prepare("SELECT DISTINCT tag FROM tags ORDER BY tag")
    .all<{ tag: string }>()
    .map((r) => r.tag);

  // ── Step 1: Search PARA docs ──
  notify?.("Searching local notes...");
  const paraResults: Array<{ title: string; path: string; snippet: string }> = [];
  const rawResults = searchDocs(db, question, {}, 10);
  for (const r of rawResults) {
    if (!paraResults.some((p) => p.path === r.path)) {
      paraResults.push({ title: r.title, path: r.path, snippet: r.body.slice(0, 200) });
    }
  }
  db.close();

  // ── Step 2: evaluateAndPlan (one LLM call) ──
  notify?.("Evaluating sources...");
  const plan = await evaluateAndPlan(question, paraResults, llmOpts);

  // ── Step 3: Fast path — docs sufficient ──
  if (!plan.needWebSearch && paraResults.length > 0) {
    notify?.("Synthesizing answer...");
    const result = await synthesizeAnswer(
      question,
      paraResults.map((r) => ({ title: r.title, content: r.snippet, citekey: null })),
      llmOpts,
      existingTags,
    );
    return {
      synthesis: result.body,
      docPath: await createAtomicNote(result.body, result.title, result.tags, cwd),
    };
  }

  // ── Step 4: Web search loop ──
  const result = await runWebSearchLoop(question, paraResults, llmOpts, cwd, notify, existingTags);
  return {
    synthesis: result.body,
    docPath: await createAtomicNote(result.body, result.title, result.tags, cwd),
  };
}
