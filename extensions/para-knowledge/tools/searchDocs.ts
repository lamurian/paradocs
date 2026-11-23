/**
 * search_para_docs tool — FTS5 BM25-powered search across PARA documents.
 *
 * Opens the existing notes.db in read-only mode (never creating or rebuilding
 * it) and runs FTS5 BM25 search with optional tag filtering. Each hit carries
 * a freshness verdict computed from the index.
 */

import { Type } from "typebox";

import { loadParadocsConfig } from "../../../common/config.ts";
import { configureEnv, getKnowledgeConfig } from "../../../common/env.ts";
import { loadFreshness, type Freshness } from "../../../common/freshness.ts";
import { missingNotesDbMessage, openNotesDbReadOnly } from "../../../common/notesDb.ts";
import { buildIdfMap } from "../../../common/recall-query.ts";
import { gateByRelevance } from "../../../common/relevance-gate.ts";
import { createLexicalScorer } from "../../../common/relevance.ts";
import { searchDocs, type SearchOptions, type SearchResult } from "../db-sqlite.ts";

import type { RelevanceConfig } from "../../../common/config-relevance.ts";
import type { SqliteDb } from "../sqlite-types.ts";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/** Relevance verdict attached to one text-matched search result. */
interface HitVerdict {
  relevance: number;
  relevant: boolean;
}

/**
 * Format a freshness verdict as a single human-readable line.
 *
 * @param f - Freshness verdict loaded from notes.db.
 * @returns Line such as `freshness: fresh (age 12d / window 365d, basis reviewed)`.
 */
function formatFreshness(f: Freshness | undefined): string {
  if (!f) return "freshness: unknown (age none d / window none d, basis none)";
  const age = f.ageDays === null ? "none" : `${f.ageDays}`;
  const window = f.windowDays === null ? "none" : `${f.windowDays}`;
  const basis = f.basis ?? "none";
  return `freshness: ${f.status} (age ${age}d / window ${window}d, basis ${basis})`;
}

/**
 * Score every text-matched hit with the lexical relevance gate.
 *
 * @param db - Open notes.db handle used to build the IDF map.
 * @param query - Raw user query.
 * @param hits - Text-matched results in BM25 order.
 * @param relevance - Relevance thresholds and weights from config.
 * @returns Verdict keyed by search result.
 */
function scoreTextHits(
  db: SqliteDb,
  query: string,
  hits: SearchResult[],
  relevance: RelevanceConfig,
): Map<SearchResult, HitVerdict> {
  const verdicts = new Map<SearchResult, HitVerdict>();
  if (hits.length === 0) return verdicts;

  const idfMap = buildIdfMap(db);
  let maxIdf = 0;
  for (const value of idfMap.values()) {
    if (value > maxIdf) maxIdf = value;
  }
  const idf = (term: string): number => idfMap.get(term) ?? maxIdf;

  const scorer = createLexicalScorer({
    threshold: relevance.kbThreshold,
    bodyWeight: relevance.bodyWeight,
    idf,
  });
  const gate = gateByRelevance(
    query,
    hits,
    (hit) => ({
      strong: [hit.title, hit.description ?? "", ...hit.tags, hit.path],
      body: hit.body,
    }),
    {
      scorers: [scorer],
      relativeCut: relevance.relativeCut,
      maxHits: hits.length,
    },
  );

  for (const entry of gate.accepted) {
    verdicts.set(entry.item, { relevance: entry.score, relevant: true });
  }
  for (const entry of gate.rejected) {
    verdicts.set(entry.item, { relevance: entry.score, relevant: false });
  }
  return verdicts;
}

/**
 * Register the search_para_docs tool.
 */
export function registerSearchDocsTool(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "search_para_docs",
    label: "Search PARA Docs",
    description:
      "Search the SQLite-indexed PARA documents (Areas/Projects/Resources) by tags and content. " +
      "Uses FTS5 BM25 ranking for text search with tag filtering.",
    promptSnippet:
      "Search for relevant knowledge documents in Areas, Projects, Resources directories",
    promptGuidelines: [
      "Use search_para_docs first when the user asks a knowledge question.",
      "Pass the user's question as query and infer relevant tags from context.",
      "Cite sources using BibTeX citation keys from @ref.bib. Use [@citekey] or @citekey inline.",
      "For existing PARA docs, reference by path — no BibTeX entry needed.",
    ],
    parameters: Type.Object({
      query: Type.String({ description: "Search query or topic" }),
      tags: Type.Optional(Type.Array(Type.String(), { description: "Filter by tag (OR logic)" })),
    }),

    execute(_toolCallId, params, _signal, onUpdate, ctx) {
      // Ensure .env is loaded (from ~/.pi/agent/.env and <cwd>/.pi/.env)
      configureEnv(ctx.cwd);

      onUpdate?.({
        content: [{ type: "text" as const, text: "🗄️ notes.db — searching…" }],
        details: {},
      });

      const query = params.query ?? "";
      const filterTags = params.tags ?? [];

      try {
        const db = openNotesDbReadOnly(ctx.cwd);
        if (!db) {
          return Promise.resolve({
            content: [{ type: "text" as const, text: missingNotesDbMessage(ctx.cwd) }],
            details: { results: [], count: 0, missing: true },
          });
        }

        const options: SearchOptions = {};
        if (filterTags.length > 0) options.tags = filterTags;
        const results = searchDocs(db, query, options);

        if (results.length === 0) {
          return Promise.resolve({
            content: [
              {
                type: "text" as const,
                text: `📭 No documents found for "${query}"${filterTags.length ? ` with tags [${filterTags.join(", ")}]` : ""}.`,
              },
            ],
            details: { results: [], count: 0 },
          });
        }

        const { dir } = getKnowledgeConfig(ctx.cwd);
        const { config } = loadParadocsConfig(dir);
        const now = new Date();

        const textHits = results.filter((r) => !r.matchedByTag);
        const tagHits = results.filter((r) => r.matchedByTag);
        const verdicts = scoreTextHits(db, query, textHits, config.relevance);
        const relevantHits = textHits.filter((r) => verdicts.get(r)?.relevant === true);
        const weakHits = textHits.filter((r) => verdicts.get(r)?.relevant !== true);
        const ordered = [...relevantHits, ...weakHits, ...tagHits];
        const freshness = ordered.map((r) => loadFreshness(db, r.path, config.freshness, now));

        const list = ordered
          .map((r, i) => {
            const verdict = verdicts.get(r);
            const rel = r.matchedByTag
              ? "tag-only"
              : verdict?.relevant
                ? `relevant ${verdict.relevance.toFixed(2)}`
                : `weak ${(verdict?.relevance ?? 0).toFixed(2)}`;
            const tagHint =
              r.tagMatches.length > 0 ? ` 🏷️${r.tagMatches.slice(0, 3).join(", ")}` : "";
            return `- [${r.title}](${r.path})  (score: ${r.score.toFixed(2)}, relevance: ${rel}${tagHint})\n  ${formatFreshness(freshness[i])}`;
          })
          .join("\n");

        return Promise.resolve({
          content: [
            {
              type: "text" as const,
              text: `🗄️ notes.db — ${ordered.length} result(s):\n\n${list}`,
            },
          ],
          details: {
            results: ordered.map((r, i) => {
              const verdict = verdicts.get(r);
              return {
                ...r,
                freshness: freshness[i],
                relevance: verdict?.relevance ?? 0,
                relevant: verdict?.relevant ?? false,
              };
            }),
            freshness,
            count: ordered.length,
          },
        });
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error("[search_para_docs] Error:", msg);
        return Promise.resolve({
          content: [{ type: "text" as const, text: `❌ Search error: ${msg.slice(0, 200)}` }],
          details: { results: [], count: 0, error: msg },
        });
      }
    },
  });
}
