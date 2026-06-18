/**
 * web-search — Three-phase search (SearXNG -> Tavily -> Bing RSS)
 *
 * Orchestrator combining search backends from searxng.ts, tavily.ts, native.ts.
 * Content fetching (fetch_url) is handled by the separate link-summarizer extension.
 *
 * Phase 1 — SearXNG category-based tiered search:
 *   Tier 1 — scientific_publications category
 *   Tier 2 — web category with site:edu OR site:gov (or overridden via category param)
 *   Tier 3 — general category
 *   All three run in strict order. Accumulated results returned if > 3.
 *   Category override via optional `category` parameter for context-aware tier 2.
 *
 * Phase 2 — Tavily fallback: only when Phase 1 accumulated <= 3 results.
 *
 * Phase 3 — Bing RSS fallback with domain filter: only when Tavily returns 0.
 *
 * Domain filtering is only applied to Bing RSS results. SearXNG category and
 * Tavily domain lists handle filtering for phases 1 and 2.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { searchSearxng } from "./searxng.js";
import { searchTavily } from "./tavily.js";
import { searchNativeHttp } from "./native.js";
import type { SearchResult } from "./native.js";

interface SearchOutput {
  results: SearchResult[];
  tier: number;
  tierLabel: string;
}

/**
 * Domain allowlist for Bing RSS (Phase 3) results.
 * Only these domains pass through the strict filter.
 */
const BING_ALLOWED_SUFFIXES = [
  ".edu",
  ".ac.uk", ".ac.nz", ".ac.jp", ".ac.kr", ".ac.in", ".ac.cn", ".ac.id",
  ".edu.au", ".edu.tw", ".edu.hk",
  ".gov", ".gov.uk", ".gov.au", ".gov.nz", ".gov.in",
  ".go.jp", ".go.kr", ".go.th", ".go.id",
  ".mil",
];

function isDomainAllowed(url: string): boolean {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return BING_ALLOWED_SUFFIXES.some((suffix) => hostname === suffix || hostname.endsWith(suffix));
  } catch {
    return false;
  }
}

/**
 * Phase 1: SearXNG category-based tiered search.
 * Runs tiers in strict order, accumulating all results.
 * Passes optional category override for tier 2 context-aware searches.
 */
async function phase1SearXNG(
  query: string,
  forcedTier: number | undefined,
  category: string | undefined,
  signal: AbortSignal | undefined,
): Promise<{ results: SearchResult[]; maxTier: number }> {
  const tiers = forcedTier !== undefined && forcedTier >= 1 && forcedTier <= 3
    ? [forcedTier]
    : [1, 2, 3];

  const allResults: SearchResult[] = [];
  let maxTier = 0;

  for (const tier of tiers) {
    // Only pass category to SearXNG for the matching tier when forcedTier is set
    const catForTier = forcedTier !== undefined && forcedTier === tier ? category : undefined;
    // When running all tiers, only tier 2 gets the category override
    const effectiveCategory = forcedTier !== undefined ? catForTier : (tier === 2 ? category : undefined);
    const results = await searchSearxng(query, tier, signal, effectiveCategory);
    allResults.push(...results);
    maxTier = Math.max(maxTier, tier);
  }

  return { results: allResults, maxTier };
}

/**
 * Phase 2: Tavily fallback.
 * Only called when Phase 1 accumulated <= 3 results.
 */
async function phase2Tavily(
  query: string,
  tier: number,
  signal: AbortSignal | undefined,
): Promise<SearchResult[]> {
  return searchTavily(query, tier, signal);
}

/**
 * Phase 3: Bing RSS fallback with strict domain filtering.
 * Only called when Tavily returns 0 results.
 */
async function phase3Bing(
  query: string,
  tier: number,
  signal: AbortSignal | undefined,
): Promise<SearchResult[]> {
  const raw = await searchNativeHttp(query, tier, signal);
  return raw.filter((r) => isDomainAllowed(r.url));
}

function formatResults(results: SearchResult[], query: string, tierLabel: string): string {
  if (!results.length) return `**No results** from any source for "${query}".`;

  const lines = results.map((r, i) => {
    let line = `${i + 1}. [${r.title}](${r.url})`;
    if (r.source_label !== "Web") line += ` — *${r.source_label}*`;
    if (r.snippet) line += `\n   ${r.snippet.slice(0, 250)}`;
    return line;
  });

  return `**Search results** for "${query}" (${tierLabel}, ${results.length} results)\n\n${lines.join("\n\n")}`;
}

async function search(
  query: string,
  forcedTier?: number,
  category?: string,
  signal?: AbortSignal,
): Promise<SearchOutput> {
  // ── Phase 1: SearXNG category-based tiered search ──
  const { results: searxngResults, maxTier } = await phase1SearXNG(query, forcedTier, category, signal);
  const usedTier = forcedTier ?? 3;

  // When a specific tier is requested, return SearXNG results as-is.
  // No fallback to Tavily/Bing — the agent explicitly chose this tier.
  if (forcedTier !== undefined) {
    const catNote = category ? ` (category: ${category})` : "";
    const label = `Phase 1 — SearXNG Tier ${forcedTier}${catNote} (${searxngResults.length} results)`;
    return { results: searxngResults, tier: usedTier, tierLabel: label };
  }

  // When running all tiers, fall through to Tavily/Bing if SearXNG
  // returned too few results.
  if (searxngResults.length > 3) {
    return {
      results: searxngResults,
      tier: usedTier,
      tierLabel: `Phase 1 — SearXNG Tiers 1→2→3 (${searxngResults.length} results)`,
    };
  }

  // ── Phase 2: Tavily fallback when SearXNG insufficient ──
  let note = `SearXNG returned ${searxngResults.length} result${searxngResults.length === 1 ? "" : "s"}, `;

  const tavilyResults = await phase2Tavily(query, maxTier || 3, signal);
  if (tavilyResults.length > 0) {
    return {
      results: tavilyResults,
      tier: usedTier,
      tierLabel: `Phase 2 — Tavily fallback (${tavilyResults.length} results, SearXNG returned ${searxngResults.length})`,
    };
  }

  // ── Phase 3: Bing RSS with domain filter ──
  note += "Tavily returned 0, ";

  const bingResults = await phase3Bing(query, maxTier || 3, signal);
  if (bingResults.length > 0) {
    return {
      results: bingResults,
      tier: usedTier,
      tierLabel: `Phase 3 — Bing RSS (domain-filtered, ${bingResults.length} results, SearXNG returned ${searxngResults.length})`,
    };
  }

  note += "Bing RSS returned 0";

  // If nothing worked but SearXNG returned something (≤ 3), return those
  if (searxngResults.length > 0) {
    return {
      results: searxngResults,
      tier: usedTier,
      tierLabel: `All phases exhausted — returning SearXNG results (${searxngResults.length})`,
    };
  }

  return {
    results: [],
    tier: usedTier,
    tierLabel: "All sources exhausted — no results found",
  };
}

export default function (pi: ExtensionAPI): void {
  pi.registerTool({
    name: "web_search",
    label: "Web Search (3-Phase: SearXNG -> Tavily -> Bing RSS)",
    description: "Three-phase web search: SearXNG category-based search (1→2→3), then Tavily, then Bing RSS with domain filtering. Tier 1 uses scientific_publications category. Tier 2 uses web category with site:edu OR site:gov (override via category param for it/news). Tier 3 uses general category.",
    promptSnippet: "Search the web (3-phase: SearXNG academic -> filtered -> general, then Tavily, then Bing RSS). Use tier=1 for academic, tier=2 for filtered web (default site:edu|gov), tier=3 for general. Pass category='it' for tech/software, 'news' for news queries, etc.",
    parameters: Type.Object({
      query: Type.String({ description: "The search query" }),
      tier: Type.Optional(
        Type.Number({
          description:
            "Force a specific SearXNG tier: 1 (academic / scientific_publications), 2 (filtered web), 3 (general). Omit to run all three in order.",
        }),
      ),
      category: Type.Optional(
        Type.String({
          description:
            "Override SearXNG category for the chosen tier. Useful for context-aware tier 2: 'it' for software/tech, 'news' for news, 'web' for general web. Only applied when tier is set. See @.pi/extensions/web-search/AGENTS.md for all supported categories.",
        }),
      ),
    }),

    async execute(_toolCallId, params, signal, _onUpdate, _ctx) {
      const { query, tier, category } = params;
      const { results, tier: usedTier, tierLabel } = await search(query, tier, category, signal);
      return {
        content: [{ type: "text" as const, text: formatResults(results, query, tierLabel) }],
        details: {
          query,
          tier: usedTier,
          category: category ?? null,
          tierLabel,
          count: results.length,
          results: results.map((r) => ({
            title: r.title,
            url: r.url,
            snippet: r.snippet,
            source_label: r.source_label,
            tier: r.tier,
          })),
        },
      };
    },
  });
}
