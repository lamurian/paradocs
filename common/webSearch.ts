/**
 * Shared web search module — three-phase orchestrator.
 *
 * Phase 1 — SearXNG category-based search.
 * Phase 2 — Tavily fallback.
 * Phase 3 — Bing RSS with domain filtering.
 *
 * @module common/webSearch
 */

import { coverageScore } from "./relevance.ts";
import { routeForKind } from "./search-routing.ts";
import { classifyTrust } from "./trust.ts";
import { searchNativeHttp } from "../extensions/web-search/native.ts";
import { searchSearxng } from "../extensions/web-search/searxng.ts";
import { searchTavily } from "../extensions/web-search/tavily.ts";

import type { SearchKind } from "./search-routing.ts";
import type { SearchResult } from "../extensions/web-search/native.ts";

// ── Types ─────────────────────────────────────────────────────────────

export type { SearchResult };

/** Options accepted by {@link searchWeb}. */
export interface SearchWebOptions {
  tier?: number;
  category?: string;
  signal?: AbortSignal;
  since?: string;
  kind?: SearchKind;
  idf?: (t: string) => number;
  minRelevant?: number;
  threshold?: number;
}

/** Result returned by {@link searchWeb}. */
export interface SearchOutput {
  results: SearchResult[];
  tier: number;
  tierLabel: string;
}

interface ScoredResult {
  result: SearchResult;
  score: number;
  index: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_MIN_RELEVANT = 0.5;

/**
 * Map a `since` date string to a search time range.
 *
 * @param since - ISO date string, or null/undefined when not supplied.
 * @param now   - Reference date used to compute the age.
 * @returns 'month' when age <= 31 days, 'year' when age <= 365 days,
 *          otherwise undefined for older, missing or invalid dates.
 */
export function sinceToTimeRange(
  since: string | null | undefined,
  now: Date,
): "month" | "year" | undefined {
  if (!since) return undefined;
  const then = new Date(since);
  if (Number.isNaN(then.getTime())) return undefined;
  const ageDays = (now.getTime() - then.getTime()) / DAY_MS;
  if (ageDays < 0) return undefined;
  if (ageDays <= 31) return "month";
  if (ageDays <= 365) return "year";
  return undefined;
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
// ── Relevance ranking ─────────────────────────────────────────────────

function strongDocument(result: SearchResult): { strong: string[] } {
  const urlField = (() => {
    try {
      const parsed = new URL(result.url);
      return `${parsed.hostname} ${parsed.pathname}`;
    } catch {
      return result.url;
    }
  })();
  return { strong: [result.title, result.snippet, urlField] };
}

function rankByRelevance(
  results: SearchResult[],
  query: string,
  idf: ((t: string) => number) | undefined,
): ScoredResult[] {
  return results
    .map((result, index) => ({
      result,
      index,
      score: coverageScore(query, strongDocument(result), { idf }),
    }))
    .sort((a, b) => b.score - a.score || a.index - b.index);
}
// ── Phase functions ───────────────────────────────────────────────────

async function phase1SearXNG(
  query: string,
  tier: number,
  category: string | undefined,
  signal: AbortSignal | undefined,
  timeRange: "month" | "year" | undefined,
): Promise<SearchResult[]> {
  return searchSearxng(query, tier, signal, category, timeRange);
}

async function phase2Tavily(
  query: string,
  tier: number,
  signal: AbortSignal | undefined,
  timeRange: "month" | "year" | undefined,
): Promise<SearchResult[]> {
  return searchTavily(query, tier, signal, timeRange);
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
    line += ` [trust: ${classifyTrust(r.url)}]`;
    if (r.snippet) line += `\n   ${r.snippet.slice(0, 250)}`;
    return line;
  });
  return `**Search results** for "${query}" (${tierLabel}, ${results.length} results)\n\n${lines.join("\n\n")}`;
}

// ── Kind routing ──────────────────────────────────────────────────────

async function searchByKind(
  query: string,
  kind: SearchKind,
  options: SearchWebOptions,
  timeRange: "month" | "year" | undefined,
): Promise<SearchOutput> {
  const route = routeForKind(kind);
  const minRelevant = options.minRelevant ?? options.threshold ?? DEFAULT_MIN_RELEVANT;
  const raw = await phase1SearXNG(
    query,
    route.tavilyTier,
    route.category,
    options.signal,
    timeRange,
  );
  const ranked = rankByRelevance(raw, query, options.idf);
  const relevant = ranked.filter((entry) => entry.score >= minRelevant).length;
  if (relevant >= 3) {
    return {
      results: ranked.map((entry) => entry.result),
      tier: route.tavilyTier,
      tierLabel: `Phase 1 — SearXNG kind ${kind} (${raw.length} results, ${relevant} relevant)`,
    };
  }
  const tavily = await phase2Tavily(query, route.tavilyTier, options.signal, timeRange);
  if (tavily.length > 0) {
    return {
      results: rankByRelevance(tavily, query, options.idf).map((entry) => entry.result),
      tier: route.tavilyTier,
      tierLabel: `Phase 2 — Tavily fallback (${tavily.length} results, SearXNG returned ${raw.length})`,
    };
  }
  const bing = await phase3Bing(query, route.tavilyTier, options.signal);
  if (bing.length > 0) {
    return {
      results: rankByRelevance(bing, query, options.idf).map((entry) => entry.result),
      tier: route.tavilyTier,
      tierLabel: `Phase 3 — Bing RSS (domain-filtered, ${bing.length} results, SearXNG returned ${raw.length})`,
    };
  }
  if (raw.length > 0) {
    return {
      results: ranked.map((entry) => entry.result),
      tier: route.tavilyTier,
      tierLabel: `All phases exhausted — returning SearXNG results (${raw.length})`,
    };
  }
  return {
    results: [],
    tier: route.tavilyTier,
    tierLabel: "All sources exhausted — no results found",
  };
}

// ── Main orchestrator ─────────────────────────────────────────────────

/**
 * Three-phase web search: SearXNG → Tavily → Bing RSS.
 *
 * Without a forced tier, one SearXNG request runs with the kind's category.
 * Results are relevance-sorted and Tavily/Bing are used when fewer than three
 * results clear the prefetch threshold. A forced tier keeps the legacy
 * tier-based fallback behaviour.
 *
 * @param query         - The search query.
 * @param options.tier  - Force a specific SearXNG tier (1, 2, or 3).
 * @param options.kind  - Search kind used when no tier is forced.
 * @param options.category - Override SearXNG category for a forced tier.
 * @param options.signal - Optional AbortSignal for cancellation.
 * @param options.since - Optional ISO date; mapped to a search time range.
 * @param options.idf - Optional IDF function for relevance scoring.
 * @param options.minRelevant - Relevance threshold (default 0.5).
 * @returns SearchOutput with results, tier used, and human-readable label.
 */
export async function searchWeb(query: string, options?: SearchWebOptions): Promise<SearchOutput> {
  const forcedTier = options?.tier;
  const signal = options?.signal;
  const timeRange = sinceToTimeRange(options?.since, new Date());
  if (forcedTier === undefined) {
    return searchByKind(query, options?.kind ?? "general", options ?? {}, timeRange);
  }
  const searxngResults = await phase1SearXNG(
    query,
    forcedTier,
    options?.category,
    signal,
    timeRange,
  );
  if (searxngResults.length > 3) {
    const catNote = options?.category ? ` (category: ${options.category})` : "";
    const label = `Phase 1 — SearXNG Tier ${forcedTier}${catNote} (${searxngResults.length} results)`;
    return { results: searxngResults.slice(0, 10), tier: forcedTier, tierLabel: label };
  }
  const tavilyResults = await phase2Tavily(query, forcedTier, signal, timeRange);
  if (tavilyResults.length > 0) {
    return {
      results: tavilyResults,
      tier: forcedTier,
      tierLabel: `Phase 2 — Tavily fallback (${tavilyResults.length} results, SearXNG returned ${searxngResults.length})`,
    };
  }
  const bingResults = await phase3Bing(query, forcedTier, signal);
  if (bingResults.length > 0) {
    return {
      results: bingResults,
      tier: forcedTier,
      tierLabel: `Phase 3 — Bing RSS (domain-filtered, ${bingResults.length} results, SearXNG returned ${searxngResults.length})`,
    };
  }
  if (searxngResults.length > 0) {
    return {
      results: searxngResults,
      tier: forcedTier,
      tierLabel: `All phases exhausted — returning SearXNG results (${searxngResults.length})`,
    };
  }
  return {
    results: [],
    tier: forcedTier,
    tierLabel: "All sources exhausted — no results found",
  };
}
