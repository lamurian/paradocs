/**
 * In-process tiered web search executor (design-B find stage).
 *
 * Runs the shared three-phase search (SearXNG → Tavily → Bing) in
 * process — no subagents — canonicalizing and deduping candidates
 * against the visited set.
 *
 * @module extensions/research-engine/search
 */

import { canonicalizeUrl } from "./fetcher.js";
import { searchWeb } from "../../common/webSearch.js";

import type { Candidate } from "./state.js";

/** Result shape of the shared web search. */
export interface SearchWebResult {
  results: Array<{ url: string; title?: string; snippet?: string }>;
  tier: number;
}

/** Injectable search backend (defaults to the shared tiered search). */
export interface SearchDeps {
  searchWeb: (query: string, opts?: { signal?: AbortSignal }) => Promise<SearchWebResult>;
}

/** Options for one search run. */
export interface RunSearchOptions {
  /** Canonical URLs that must not reappear (visited set). */
  exclude?: Set<string>;
  /** Candidate cap (default 30). */
  maxCandidates?: number;
  /** Query cap (default 4). */
  maxQueries?: number;
  /** Search backend override (tests). */
  deps?: SearchDeps;
  signal?: AbortSignal;
}

/**
 * Execute tiered web searches for a query set, deduped and capped.
 *
 * Per-query failures are swallowed (the pipeline's sufficiency gates
 * detect thin candidate sets); the abort signal stops between queries.
 *
 * @param queries - Search queries from the query-gen stage.
 * @param opts - Exclusion set, caps, backend, signal.
 * @returns Search candidates in discovery order.
 */
export async function runSearch(
  queries: string[],
  opts: RunSearchOptions = {},
): Promise<Candidate[]> {
  const deps = opts.deps ?? { searchWeb: (q, o) => searchWeb(q, o) };
  const seen = new Set<string>(opts.exclude ?? []);
  const out: Candidate[] = [];
  const maxCandidates = opts.maxCandidates ?? 30;
  const maxQueries = Math.min(queries.length, opts.maxQueries ?? 4);

  for (let qi = 0; qi < maxQueries; qi++) {
    if (opts.signal?.aborted) break;
    const query = queries[qi];
    let res: SearchWebResult;
    try {
      res = await deps.searchWeb(query, { signal: opts.signal });
    } catch {
      continue;
    }
    for (const r of res.results) {
      const canonicalUrl = canonicalizeUrl(r.url);
      if (seen.has(canonicalUrl)) continue;
      seen.add(canonicalUrl);
      out.push({
        url: r.url,
        canonicalUrl,
        title: r.title,
        snippet: r.snippet,
        tier: res.tier,
        query,
      });
      if (out.length >= maxCandidates) return out;
    }
  }
  return out;
}
