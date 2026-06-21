/**
 * Shared web search module — three-phase orchestrator.
 *
 * Phase 1 — SearXNG category-based tiered search.
 * Phase 2 — Tavily fallback.
 * Phase 3 — Bing RSS with domain filtering.
 *
 * @module common/webSearch
 */

import { searchNativeHttp } from "../extensions/web-search/native.js";
import { searchSearxng } from "../extensions/web-search/searxng.js";
import { searchTavily } from "../extensions/web-search/tavily.js";

import type { SearchResult } from "../extensions/web-search/native.js";

// ── Types ─────────────────────────────────────────────────────────────

export type { SearchResult };

export interface SearchOutput {
  results: SearchResult[];
  tier: number;
  tierLabel: string;
}

// ── Domain filtering (Phase 3 only) ───────────────────────────────────

const BING_ALLOWED_SUFFIXES = [
  ".edu",
  ".ac.uk",
  ".ac.nz",
  ".ac.jp",
  ".ac.kr",
  ".ac.in",
  ".ac.cn",
  ".ac.id",
  ".edu.au",
  ".edu.tw",
  ".edu.hk",
  ".gov",
  ".gov.uk",
  ".gov.au",
  ".gov.nz",
  ".gov.in",
  ".go.jp",
  ".go.kr",
  ".go.th",
  ".go.id",
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

// ── Phase functions ───────────────────────────────────────────────────

async function phase1SearXNG(
  query: string,
  forcedTier: number | undefined,
  category: string | undefined,
  signal: AbortSignal | undefined,
): Promise<{ results: SearchResult[]; maxTier: number }> {
  const tiers =
    forcedTier !== undefined && forcedTier >= 1 && forcedTier <= 3 ? [forcedTier] : [1, 2, 3];

  const allResults: SearchResult[] = [];
  let maxTier = 0;

  for (const tier of tiers) {
    const catForTier = forcedTier !== undefined && forcedTier === tier ? category : undefined;
    const effectiveCategory =
      forcedTier !== undefined ? catForTier : tier === 2 ? category : undefined;
    const results = await searchSearxng(query, tier, signal, effectiveCategory);
    allResults.push(...results);
    maxTier = Math.max(maxTier, tier);
  }

  return { results: allResults, maxTier };
}

async function phase2Tavily(
  query: string,
  tier: number,
  signal: AbortSignal | undefined,
): Promise<SearchResult[]> {
  return searchTavily(query, tier, signal);
}

async function phase3Bing(
  query: string,
  tier: number,
  signal: AbortSignal | undefined,
): Promise<SearchResult[]> {
  const raw = await searchNativeHttp(query, tier, signal);
  return raw.filter((r) => isDomainAllowed(r.url));
}

export function formatResults(results: SearchResult[], query: string, tierLabel: string): string {
  if (!results.length) return `**No results** from any source for "${query}".`;

  const lines = results.map((r, i) => {
    let line = `${i + 1}. [${r.title}](${r.url})`;
    if (r.source_label !== "Web") line += ` — *${r.source_label}*`;
    if (r.snippet) line += `\n   ${r.snippet.slice(0, 250)}`;
    return line;
  });

  return `**Search results** for "${query}" (${tierLabel}, ${results.length} results)\n\n${lines.join("\n\n")}`;
}

// ── Main orchestrator ─────────────────────────────────────────────────

/**
 * Three-phase web search: SearXNG → Tavily → Bing RSS.
 *
 * Phase 1 runs SearXNG with tier-based categories. When sufficient results
 * (>3) are found, returns immediately. Otherwise falls through to
 * Phase 2 (Tavily) and Phase 3 (Bing RSS with domain filtering).
 *
 * When a specific tier is forced, returns SearXNG results directly without
 * falling through to Tavily/Bing.
 *
 * @param query         - The search query.
 * @param options.tier  - Force a specific SearXNG tier (1, 2, or 3).
 * @param options.category - Override SearXNG category (e.g. "it", "news").
 * @param options.signal - Optional AbortSignal for cancellation.
 * @returns SearchOutput with results, tier used, and human-readable label.
 */
export async function searchWeb(
  query: string,
  options?: { tier?: number; category?: string; signal?: AbortSignal },
): Promise<SearchOutput> {
  const forcedTier = options?.tier;
  const category = options?.category;
  const signal = options?.signal;

  // ── Phase 1: SearXNG ──
  const { results: searxngResults, maxTier } = await phase1SearXNG(
    query,
    forcedTier,
    category,
    signal,
  );
  const usedTier = forcedTier ?? 3;

  if (forcedTier !== undefined) {
    const catNote = category ? ` (category: ${category})` : "";
    const label = `Phase 1 — SearXNG Tier ${forcedTier}${catNote} (${searxngResults.length} results)`;
    return { results: searxngResults, tier: usedTier, tierLabel: label };
  }

  if (searxngResults.length > 3) {
    return {
      results: searxngResults,
      tier: usedTier,
      tierLabel: `Phase 1 — SearXNG Tiers 1→2→3 (${searxngResults.length} results)`,
    };
  }

  // ── Phase 2: Tavily ──
  const tavilyResults = await phase2Tavily(query, maxTier || 3, signal);
  if (tavilyResults.length > 0) {
    return {
      results: tavilyResults,
      tier: usedTier,
      tierLabel: `Phase 2 — Tavily fallback (${tavilyResults.length} results, SearXNG returned ${searxngResults.length})`,
    };
  }

  // ── Phase 3: Bing RSS ──
  const bingResults = await phase3Bing(query, maxTier || 3, signal);
  if (bingResults.length > 0) {
    return {
      results: bingResults,
      tier: usedTier,
      tierLabel: `Phase 3 — Bing RSS (domain-filtered, ${bingResults.length} results, SearXNG returned ${searxngResults.length})`,
    };
  }

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
