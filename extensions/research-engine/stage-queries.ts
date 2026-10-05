/**
 * QUERY_GEN and REFINE stage executors.
 *
 * After the subagent collapse, QUERY_GEN performs only the deterministic
 * KB search (no LLM); the search subagent runs in the SEARCH stage.
 * REFINE is a deterministic passthrough — next-cycle context (gaps,
 * covered facets, visited URLs) flows through state into the search task.
 *
 * @module extensions/research-engine/stage-queries
 */

import type { ResearchEvent } from "./events.js";
import type { ResearchDeps } from "./research-deps.js";
import type { KbDocGist, ResearchState } from "./state.js";

/**
 * Deterministic KB freshness ratio for the kbCovered formula.
 *
 * @param kbDocs - KB doc gists with optional ISO dates.
 * @param windowDays - Freshness window; null disables (ratio 1).
 * @param nowMs - Current epoch ms.
 * @returns Fresh/datable ratio, or null when no docs.
 */
export function kbFreshRatio(
  kbDocs: KbDocGist[],
  windowDays: number | null,
  nowMs: number,
): number | null {
  if (kbDocs.length === 0) return null;
  if (windowDays === null) return 1;
  const nowYear = new Date(nowMs).getUTCFullYear();
  const minYear = nowYear - Math.max(1, Math.floor(windowDays / 365));
  const years = kbDocs
    .map((d) => d.date?.match(/(\d{4})/)?.[1])
    .filter((y): y is string => Boolean(y));
  if (years.length === 0) return 0;
  return years.filter((y) => Number(y) >= minYear).length / years.length;
}

/**
 * QUERY_GEN: deterministic KB search only (no LLM call).
 *
 * KB doc titles are injected into the search subagent prompt in the
 * SEARCH stage; kbSufficient stays null (no LLM verdict), which keeps
 * the kbCovered short-circuit conservative.
 *
 * @param state - Current research state.
 * @param deps - Injected I/O surface.
 * @param now - Clock.
 * @returns queries_generated event.
 */
export async function stageQueryGen(
  state: ResearchState,
  deps: ResearchDeps,
  now: () => number,
): Promise<ResearchEvent> {
  let rawDocs: Awaited<ReturnType<ResearchDeps["searchDocs"]>>;
  try {
    rawDocs = await deps.searchDocs(state.question);
  } catch {
    rawDocs = [];
  }
  const kbDocs: KbDocGist[] = rawDocs.map((d) => ({
    title: d.title,
    path: d.path,
    date: d.created,
  }));
  return {
    type: "queries_generated",
    queries: [state.question],
    kbDocs,
    kbSufficient: null,
    kbFreshRatio: kbFreshRatio(kbDocs, state.profile.freshnessWindowDays, now()),
  };
}

/**
 * REFINE: deterministic cycle advance.
 *
 * The next cycle's search task is built from state (gaps, covered
 * facets, visited URLs) inside the search runner, so no LLM call is
 * needed here — the event just advances the cycle bookkeeping.
 *
 * @param state - Current research state.
 * @returns refined event (deterministic fallback).
 */
export function stageRefine(state: ResearchState, _deps: ResearchDeps): Promise<ResearchEvent> {
  return Promise.resolve({
    type: "refined",
    questions: [state.question],
    coveredFacets: [],
    llmErrors: 0,
  });
}
