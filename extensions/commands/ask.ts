/**
 * /ask command — deterministic JS-orchestrated research loop.
 *
 * Generates keywords, searches PARA docs, evaluates, optionally runs
 * web search with citation resolution, synthesizes, and always creates
 * an atomic note. LLM only handles text generation.
 *
 * @module extensions/commands/ask
 */

import { resolve } from "node:path";

import { complete } from "@earendil-works/pi-ai";
import { BorderedLoader } from "@earendil-works/pi-coding-agent";

import {
  generateKeywords,
  evaluateResults,
  generateWebQueries,
  checkEnoughInfo,
  synthesizeAnswer,
} from "./ask-helpers.js";
import { resolveCitation } from "../../common/citation.js";
import { createDocument } from "../../common/createDocument.js";
import { configureEnv, getKnowledgeConfig } from "../../common/env.js";
import { fetchUrlAsText } from "../../common/fetchUrl.js";
import { searchWeb } from "../../common/webSearch.js";
import { createDb, initDb, searchDocs } from "../para-knowledge/db-sqlite.js";

import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

// ── Constants ───────────────────────────────────────────────────────

const MAX_SEARCH_ROUNDS = 3;

/** Human-readable description shown in /commands list */
export const description = "Ask a question and get a knowledge document answer";

// ── Helpers ─────────────────────────────────────────────────────────

function slugFromQuestion(question: string): string {
  return question
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
}

/**
 * Execute the full research loop: keywords → PARA search → evaluation →
 * web search → synthesis → atomic note creation.
 */
async function executeResearchLoop(
  question: string,
  llmOpts: {
    model: Parameters<typeof complete>[0];
    apiKey: string;
    headers?: Record<string, string>;
    signal?: AbortSignal;
  },
  cwd: string,
): Promise<{ synthesis: string; docPath: string }> {
  configureEnv(cwd);
  const { dir, db: dbName } = getKnowledgeConfig(cwd);
  const db = createDb(resolve(dir, dbName));
  initDb(db);

  // Step 1: Generate keywords
  const keywords = await generateKeywords(question, llmOpts);

  // Step 2: Search PARA docs
  const paraResults: Array<{ title: string; path: string; snippet: string }> = [];
  for (const kw of keywords) {
    const results = searchDocs(db, kw, {}, 5);
    for (const r of results) {
      if (!paraResults.some((p) => p.path === r.path)) {
        paraResults.push({ title: r.title, path: r.path, snippet: r.body.slice(0, 200) });
      }
    }
  }
  db.close();

  // Step 3: Evaluate if web search needed
  const decision = await evaluateResults(question, paraResults, llmOpts);

  if (!decision.needWebSearch && paraResults.length > 0) {
    return await synthesizeFromParadocs(question, paraResults, llmOpts, cwd);
  }

  // Step 4: Web search loop
  const synthesis = await runWebSearchLoop(question, paraResults, llmOpts, cwd);

  // Step 5: Always create atomic note
  const title = `Research: ${question.slice(0, 60)}`;
  const topicSlug = slugFromQuestion(question);
  const doc = await createDocument(
    {
      title,
      content: synthesis,
      tags: ["research", ...topicSlug.split("-").slice(0, 3)],
      area: "Resources",
      description: `Research synthesis on: ${question.slice(0, 100)}`,
    },
    { cwd },
  );

  return { synthesis, docPath: doc.path };
}

/**
 * Synthesize from existing PARA documents only.
 */
async function synthesizeFromParadocs(
  question: string,
  paraResults: Array<{ title: string; path: string; snippet: string }>,
  llmOpts: {
    model: Parameters<typeof complete>[0];
    apiKey: string;
    headers?: Record<string, string>;
    signal?: AbortSignal;
  },
  cwd: string,
): Promise<{ synthesis: string; docPath: string }> {
  const synthesis = await synthesizeAnswer(
    question,
    paraResults.map((r) => ({ title: r.title, content: r.snippet, citekey: null })),
    llmOpts,
  );

  const title = `Answer: ${question.slice(0, 60)}`;
  const doc = await createDocument(
    {
      title,
      content: synthesis,
      tags: ["research", ...slugFromQuestion(question).split("-").slice(0, 3)],
      area: "Resources",
      description: `Research synthesis: ${question.slice(0, 100)}`,
    },
    { cwd },
  );

  return { synthesis, docPath: doc.path };
}

/**
 * Run the iterative web search loop up to MAX_SEARCH_ROUNDS.
 */
async function runWebSearchLoop(
  question: string,
  paraResults: Array<{ title: string; path: string; snippet: string }>,
  llmOpts: {
    model: Parameters<typeof complete>[0];
    apiKey: string;
    headers?: Record<string, string>;
    signal?: AbortSignal;
  },
  cwd: string,
): Promise<string> {
  const sources: Array<{
    title: string;
    content: string;
    citekey: string | null;
    url: string;
    excerpt: string;
  }> = [];

  for (let round = 0; round < MAX_SEARCH_ROUNDS; round++) {
    const queries = await generateWebQueries(
      question,
      sources.map((s) => ({ title: s.title, url: s.url, citekey: s.citekey })),
      round,
      llmOpts,
    );

    for (const q of queries) {
      const webResults = await searchWeb(q, { tier: 2, signal: llmOpts.signal });
      for (const r of webResults.results.slice(0, 3)) {
        if (sources.some((s) => s.url === r.url)) continue;

        const content = await fetchUrlAsText(r.url, llmOpts.signal);
        if ("error" in content) continue;

        const citation = await resolveCitation({ source: r.url, title: r.title }, { cwd });

        sources.push({
          title: content.title || r.title,
          content: content.content,
          citekey: citation.citekey,
          url: r.url,
          excerpt: content.content.slice(0, 300),
        });
      }
    }

    if (sources.length > 0) {
      const enough = await checkEnoughInfo(question, sources, llmOpts);
      if (enough) break;
    }
  }

  const allSources = [
    ...paraResults.map((r) => ({ title: r.title, content: r.snippet, citekey: null })),
    ...sources.map((s) => ({ title: s.title, content: s.content, citekey: s.citekey })),
  ];

  return await synthesizeAnswer(question, allSources, llmOpts);
}

function formatFinalMessage(question: string, synthesis: string, docPath: string | null): string {
  const lines = [`## Answer: ${question}`, "", synthesis];
  if (docPath) {
    const trimmed = question.length > 60 ? question.slice(0, 60) + "…" : question;
    lines.push("", `---`, `📝 Atomic note created at \`${docPath}\``);
    lines.push(`**Summary**: Research synthesis on "${trimmed}"`);
  }
  return lines.join("\n");
}

// ── Handler ─────────────────────────────────────────────────────────

/**
 * Create the /ask command handler.
 *
 * @param pi  The pi extension API instance.
 * @returns   The command handler function.
 */
export function createHandler(pi: ExtensionAPI) {
  return async (args: string, ctx: ExtensionCommandContext): Promise<void> => {
    const question = args.trim();

    if (!question) {
      ctx.ui.notify("Usage: /ask <question> — please provide a question.", "warning");
      return;
    }

    if (typeof ctx.ui.custom !== "function") {
      ctx.ui.notify("/ask requires interactive (TUI) mode.", "error");
      return;
    }

    if (!ctx.model) {
      ctx.ui.notify("No model selected. Please select a model first (Ctrl+P).", "error");
      return;
    }

    try {
      ctx.ui.notify(`🔍 Researching: "${question.slice(0, 80)}…"`, "info");

      const model = ctx.model as Parameters<typeof complete>[0];

      const result = await ctx.ui.custom<{
        synthesis: string;
        docPath: string | null;
      } | null>((tui, theme, _kb, done) => {
        const loader = new BorderedLoader(tui, theme, "🔬 Researching…");
        loader.onAbort = () => done(null);

        const run = async () => {
          try {
            const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
            if (!auth.ok || !auth.apiKey) {
              ctx.ui.notify("Failed to get API key for model.", "error");
              done(null);
              return;
            }
            const llmOpts = {
              model,
              apiKey: auth.apiKey,
              headers: auth.headers,
              signal: loader.signal,
            };

            const { synthesis, docPath } = await executeResearchLoop(question, llmOpts, ctx.cwd);
            done({ synthesis, docPath });
          } catch (err) {
            console.error("[ask] Orchestration error:", err);
            ctx.ui.notify(
              `❌ Research error: ${err instanceof Error ? err.message : String(err)}`,
              "error",
            );
            done(null);
          }
        };

        void run();
        return loader;
      });

      if (result) {
        pi.sendUserMessage(formatFinalMessage(question, result.synthesis, result.docPath));
      }

      await Promise.resolve();
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      ctx.ui.notify(`❌ /ask error: ${msg}`, "error");
    }
  };
}
