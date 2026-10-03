/**
 * QUERY_GEN and REFINE stage executors.
 *
 * @module extensions/research-engine/stage-queries
 */

import { parseQueries, parseRefine, prompt } from "./effects.js";
import { refineResult } from "./reformulate.js";

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

function describePhase(state: ResearchState): string {
  const breadth = state.mode === "breadth" && state.cycle === 1;
  return breadth ? "breadth" : `depth (cycle ${state.cycle})`;
}

/**
 * QUERY_GEN: KB search + LLM query formulation (+ research facet fill).
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
  const freshRatio = kbFreshRatio(kbDocs, state.profile.freshnessWindowDays, now());
  const phase = describePhase(state);

  const user = [
    `Question: ${state.question}\nPhase: ${phase}`,
    kbDocs.length > 0
      ? `KB documents:\n${kbDocs
          .map((d) => `- ${d.title}${d.date ? ` (${d.date.slice(0, 10)})` : ""}`)
          .join("\n")}`
      : "KB documents: none found",
    state.askedQuestions.length > 0
      ? `Already asked (never repeat):\n${state.askedQuestions.map((q) => `- ${q}`).join("\n")}`
      : "",
    state.gaps.length > 0 ? `Known gaps:\n${state.gaps.map((g) => `- ${g}`).join("\n")}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  const res = await deps.llm({
    system: prompt("query-gen"),
    user,
    parse: (t) => parseQueries(t),
    timeoutMs: deps.llmTimeoutMs,
    label: "Querying…",
  });

  let queries: string[];
  let kbSufficient: boolean | null = null;
  let llmErrors = 0;
  if (res.ok && res.value && typeof res.value === "object") {
    const v = res.value as { queries?: string[]; kbSufficient?: boolean | null };
    if (Array.isArray(v.queries) && v.queries.length > 0) {
      queries = v.queries;
      kbSufficient = v.kbSufficient ?? null;
    } else {
      llmErrors = 1;
      queries = [state.question];
    }
  } else {
    llmErrors = 1;
    queries = [state.question];
  }

  // Deterministic breadth facet fill for /research (contract: reformulator breadth phase).
  if (state.profile.name === "research" && state.cycle === 1) {
    const rr = refineResult({
      phase: "breadth",
      topic: state.question,
      asked: state.askedQuestions,
      coveredFacets: [],
      gaps: [],
      parsed: { questions: queries, coveredFacets: [] },
    });
    queries = rr.questions;
  }

  return {
    type: "queries_generated",
    queries,
    kbDocs,
    kbSufficient,
    kbFreshRatio: freshRatio,
    llmErrors,
  };
}

/**
 * REFINE: gap-targeted next-cycle questions (depth phase).
 *
 * @param state - Current research state.
 * @param deps - Injected I/O surface.
 * @returns refined event (falls back deterministically on LLM failure).
 */
export async function stageRefine(
  state: ResearchState,
  deps: ResearchDeps,
): Promise<ResearchEvent> {
  const user = [
    `Question: ${state.question}\nPhase: depth (cycle ${state.cycle} → ${state.cycle + 1})`,
    state.gaps.length > 0
      ? `Reported gaps:\n${state.gaps.map((g) => `- ${g}`).join("\n")}`
      : "Reported gaps: none recorded",
    state.coveredFacets.length > 0
      ? `Covered facets (exclude):\n${state.coveredFacets.join(", ")}`
      : "",
    `Already asked (never repeat):\n${state.askedQuestions.map((q) => `- ${q}`).join("\n")}`,
  ]
    .filter(Boolean)
    .join("\n\n");

  const res = await deps.llm({
    system: prompt("reformulate"),
    user,
    parse: (t) => parseRefine(t),
    timeoutMs: deps.llmTimeoutMs,
    label: "Refining…",
  });
  const parsed =
    res.ok && res.value && typeof res.value === "object"
      ? (res.value as { questions: string[]; coveredFacets: string[] })
      : null;
  const rr = refineResult({
    phase: "depth",
    topic: state.question,
    asked: state.askedQuestions,
    coveredFacets: state.coveredFacets,
    gaps: state.gaps,
    parsed,
  });
  return {
    type: "refined",
    questions: rr.questions,
    coveredFacets: rr.coveredFacets,
    llmErrors: parsed ? 0 : 1,
  };
}
