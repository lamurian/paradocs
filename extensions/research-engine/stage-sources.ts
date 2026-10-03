/**
 * SEARCH, RANK, and FETCH stage executors.
 *
 * @module extensions/research-engine/stage-sources
 */

import { parseRanked, prompt } from "./effects.js";
import { fetchRecords } from "./fetcher.js";
import { runSearch } from "./search.js";

import type { ResearchEvent } from "./events.js";
import type { ResearchDeps } from "./research-deps.js";
import type { Candidate, FetchRecord, ResearchState } from "./state.js";

/**
 * Order candidates by ranked URL list, keeping unranked ones at the end
 * in discovery order.
 *
 * @param candidates - All candidates from SEARCH.
 * @param rankedUrls - Canonical URLs in ranker order.
 * @returns Ordered candidates.
 */
export function orderCandidates(candidates: Candidate[], rankedUrls: string[]): Candidate[] {
  const byUrl = new Map(candidates.map((c) => [c.canonicalUrl, c]));
  const out: Candidate[] = [];
  for (const u of rankedUrls) {
    const c = byUrl.get(u);
    if (c) {
      out.push(c);
      byUrl.delete(u);
    }
  }
  for (const rest of byUrl.values()) out.push(rest);
  return out;
}

/**
 * SEARCH: run tiered web searches in process, deduped vs visited.
 *
 * @param state - Current research state.
 * @param deps - Injected I/O surface.
 * @returns search_done event.
 */
export async function stageSearch(
  state: ResearchState,
  deps: ResearchDeps,
): Promise<ResearchEvent> {
  const candidates = await runSearch(state.queries, {
    exclude: new Set(state.visited),
    deps: deps.searchDeps,
    signal: deps.signal,
  });
  return { type: "search_done", candidates };
}

/**
 * RANK: LLM suitability filter with a deterministic tier-order fallback.
 *
 * @param state - Current research state.
 * @param deps - Injected I/O surface.
 * @returns ranked event.
 */
export async function stageRank(state: ResearchState, deps: ResearchDeps): Promise<ResearchEvent> {
  const allowed = new Set(state.candidates.map((c) => c.canonicalUrl));
  const lines = state.candidates
    .map(
      (c, i) =>
        `${i + 1}. ${c.title ?? "(no title)"} | ${c.url} | ${(c.snippet ?? "").slice(0, 200)}`,
    )
    .join("\n");
  const topK = Math.min(12, state.profile.targetSources + 2);
  const res = await deps.llm({
    system: prompt("rank"),
    user: `Question: ${state.question}\nReturn at most ${topK} URLs.\n\n${lines}`,
    parse: (t) => parseRanked(t, allowed),
    timeoutMs: deps.llmTimeoutMs,
    label: "Ranking…",
  });

  if (res.ok && Array.isArray(res.value) && res.value.length > 0) {
    return {
      type: "ranked",
      candidates: orderCandidates(state.candidates, res.value as string[]),
    };
  }
  // Deterministic fallback: tier order, discovery order preserved within tier.
  const fallback = [...state.candidates].sort((a, b) => a.tier - b.tier);
  return { type: "ranked", candidates: fallback, llmErrors: res.ok ? 0 : 1 };
}

/**
 * FETCH: parallel deterministic fetch with metadata for unvisited URLs.
 *
 * @param state - Current research state.
 * @param deps - Injected I/O surface.
 * @param now - Clock.
 * @returns fetched event.
 */
export async function stageFetch(
  state: ResearchState,
  deps: ResearchDeps,
  now: () => number,
): Promise<ResearchEvent> {
  const visited = new Set(state.visited);
  const urls = [
    ...new Set(state.candidates.map((c) => c.canonicalUrl).filter((u) => !visited.has(u))),
  ];
  const tiers = new Map(state.candidates.map((c) => [c.canonicalUrl, c.tier]));
  const records: FetchRecord[] = await fetchRecords(urls, {
    fetchFn: deps.fetchUrl,
    concurrency: deps.fetchConcurrency,
    timeoutMs: deps.fetchTimeoutMs,
    tiers,
    now,
    signal: deps.signal,
  });
  return { type: "fetched", records };
}
