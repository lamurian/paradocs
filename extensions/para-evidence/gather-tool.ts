/**
 * gather_evidence — deterministic evidence gathering tool.
 *
 * Thin adapter around common/gather-evidence.ts. The KB is consulted first
 * via the read-only notes.db index, uncovered queries fall back to the
 * shared web search, and the resulting sources are fetched with
 * fetchUrlWithTimeout. The finished pack is persisted with saveEvidencePack.
 *
 * @module extensions/para-evidence/gather-tool
 */

import { Type } from "typebox";

import { loadParadocsConfig } from "../../common/config.ts";
import { getKnowledgeConfig } from "../../common/env.ts";
import { saveEvidencePack } from "../../common/evidence-cache.ts";
import { fetchUrlWithTimeout } from "../../common/fetchUrl.ts";
import { loadFreshness } from "../../common/freshness.ts";
import { gatherEvidence } from "../../common/gather-evidence.ts";
import { openNotesDbReadOnly } from "../../common/notesDb.ts";
import { searchWeb as runWebSearch } from "../../common/webSearch.ts";
import { searchDocs } from "../para-knowledge/sqlite-search.ts";

import type { EvidencePack } from "../../common/evidence-cache.ts";
import type { GatherEvidenceDeps, GatherKbHit } from "../../common/gather-evidence.ts";
import type { SearchResult } from "../web-search/native.ts";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/** Maximum characters of each source excerpt shown in the tool output. */
const EXCERPT_PREVIEW_CHARS = 300;

/** Injected dependencies for {@link registerGatherEvidenceTool}. */
export interface GatherToolDeps {
  searchKb: (query: string) => GatherKbHit[];
  searchWeb: (query: string, opts: { since: string | null }) => Promise<SearchResult[]>;
  fetch: (
    url: string,
    timeoutMs: number,
    signal?: AbortSignal,
  ) => Promise<{ title: string; content: string } | { error: string }>;
  now?: () => Date;
}

/**
 * Build the production dependencies for one working directory.
 *
 * `searchKb` opens notes.db read-only and returns no hits when the index is
 * missing, so a gather call never creates or rebuilds it.
 *
 * @param cwd - Project working directory used to resolve the KB.
 * @returns Dependencies backed by notes.db, the shared web search and fetch.
 */
export function createDefaultGatherDeps(cwd: string): GatherToolDeps {
  const now = (): Date => new Date();

  return {
    searchKb: (query: string): GatherKbHit[] => {
      const db = openNotesDbReadOnly(cwd);
      if (!db) return [];
      const { dir } = getKnowledgeConfig(cwd);
      const { config } = loadParadocsConfig(dir);
      const reference = now();
      return searchDocs(db, query).map((result) => ({
        path: result.path,
        title: result.title,
        description: result.description ?? "",
        freshness: loadFreshness(db, result.path, config.freshness, reference),
      }));
    },
    searchWeb: async (query: string, opts: { since: string | null }): Promise<SearchResult[]> => {
      const output = await runWebSearch(query, opts.since ? { since: opts.since } : {});
      return output.results;
    },
    fetch: (url: string, timeoutMs: number, signal?: AbortSignal) =>
      fetchUrlWithTimeout(url, timeoutMs, signal),
    now,
  };
}

/**
 * Render a stored evidence pack as compact gather output.
 *
 * Shows the pack id, one coverage block per query (including the freshness
 * status of each KB hit) and one block per source with the first 300
 * characters of its excerpt.
 *
 * @param pack - Stored evidence pack.
 * @returns Human-readable gather summary.
 */
export function formatGatherResult(pack: EvidencePack): string {
  const lines = [
    `Evidence pack ${pack.id}`,
    `Question: ${pack.question}`,
    `Created: ${pack.createdAt}`,
    "",
    "Coverage:",
  ];

  if (pack.queries.length === 0) lines.push("- (none)");
  for (const query of pack.queries) {
    lines.push(`- ${query.query}`);
    lines.push(`  kb covered: ${query.kbCovered ? "yes" : "no"}`);
    lines.push(`  since: ${query.since ?? "n/a"}`);
    if (query.kbHits.length === 0) {
      lines.push("  kb hits: (none)");
    } else {
      for (const hit of query.kbHits) {
        lines.push(`  kb hit: ${hit.path} — ${hit.title} (${hit.freshness})`);
      }
    }
  }

  lines.push("", `Sources (${pack.sources.length}):`);
  if (pack.sources.length === 0) lines.push("- (none)");
  pack.sources.forEach((source, index) => {
    lines.push(`${index + 1}. ${source.title}`);
    lines.push(`   url: ${source.url}`);
    lines.push(`   trust: ${source.trust}`);
    lines.push(`   excerpt: ${source.excerpt.slice(0, EXCERPT_PREVIEW_CHARS)}`);
  });

  return lines.join("\n");
}

/**
 * Register the gather_evidence tool.
 *
 * @param pi - The pi extension API.
 * @param deps - Optional injected dependencies (default: real KB, web, fetch).
 */
export function registerGatherEvidenceTool(pi: ExtensionAPI, deps?: GatherToolDeps): void {
  pi.registerTool({
    name: "gather_evidence",
    label: "Gather Evidence",
    description:
      "Gather a deterministic evidence pack for a knowledge question. Consults " +
      "the PARA knowledge base first and falls back to web search for uncovered " +
      "or stale facets, then fetches and ranks the sources. The pack is saved " +
      "and can be read later with get_evidence.",
    promptSnippet: "Gather and save an evidence pack for a knowledge question",
    promptGuidelines: [
      "A knowledge question is any claim not verifiable from the repo or the conversation: external facts, versions, standards, research findings, best practices, comparisons. Repo-internal questions use code search, never gather_evidence.",
      "Call gather_evidence after search_para_docs or the KB recall block when: no relevant hit exists or a facet is uncovered; any relevant hit is stale or unknown; a fast-changing claim (versions, pricing, current best practice) rests on an aging hit; or you are about to make a factual claim you cannot cite.",
      "Pass one query per facet (1-5). In implement, reuse evidence ids from discuss via get_evidence and call gather_evidence only for new gaps with maxSources 3.",
      "Never call gather_evidence during finalize.",
    ],
    parameters: Type.Object({
      question: Type.String({ description: "The knowledge question being answered" }),
      queries: Type.Array(Type.String(), {
        description: "One search query per facet (1-5 queries)",
      }),
      maxSources: Type.Optional(
        Type.Number({ description: "Maximum sources to fetch (default 5, cap 10)" }),
      ),
      force: Type.Optional(
        Type.Boolean({ description: "Search the web even when the KB is fresh (default false)" }),
      ),
    }),

    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const active = deps ?? createDefaultGatherDeps(ctx.cwd);
      const gatherDeps: GatherEvidenceDeps = {
        searchKb: active.searchKb,
        searchWeb: active.searchWeb,
        fetch: active.fetch,
        now: active.now ?? (() => new Date()),
      };

      const raw = await gatherEvidence(params, gatherDeps, signal);
      const pack = saveEvidencePack(ctx.cwd, raw);

      return {
        content: [{ type: "text" as const, text: formatGatherResult(pack) }],
        details: {
          id: pack.id,
          question: pack.question,
          queries: pack.queries,
          sources: pack.sources.map((source) => ({
            title: source.title,
            url: source.url,
            trust: source.trust,
          })),
        },
      };
    },
  });
}
