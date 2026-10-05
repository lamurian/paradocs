/**
 * SEARCH, RANK, and FETCH stage executors.
 *
 * After the subagent collapse, SEARCH runs the search subagent (via the
 * runner — query formulation, tiered web_search, and suitability
 * assessment all happen inside it). RANK is a deterministic passthrough:
 * the subagent already assessed suitability, so candidates keep their
 * returned order. FETCH stays in-process and deterministic.
 *
 * @module extensions/research-engine/stage-sources
 */

import { fetchRecords } from "./fetcher.js";
import { runSearchStage } from "./runner.js";

import type { ResearchEvent } from "./events.js";
import type { ResearchDeps } from "./research-deps.js";
import type { Candidate, FetchRecord, ResearchState } from "./state.js";

/**
 * SEARCH: run the search subagent (one call: queries + web_search +
 * suitability), map its output to visited-filtered candidates.
 *
 * @param state - Current research state.
 * @param deps - Injected I/O surface.
 * @returns search_done event.
 */
export async function stageSearch(
  state: ResearchState,
  deps: ResearchDeps,
): Promise<ResearchEvent> {
  return runSearchStage(state, deps);
}

/**
 * RANK: deterministic passthrough.
 *
 * The search subagent already assessed title/snippet suitability, so
 * candidates keep their returned order — no LLM re-ranking.
 *
 * @param state - Current research state.
 * @returns ranked event with candidates unchanged.
 */
export function stageRank(state: ResearchState, _deps: ResearchDeps): Promise<ResearchEvent> {
  const candidates: Candidate[] = state.candidates;
  return Promise.resolve({ type: "ranked", candidates, llmErrors: 0 });
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
