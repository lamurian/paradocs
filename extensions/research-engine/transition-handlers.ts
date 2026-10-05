/**
 * FSM transition handlers: one function per event plus abort/budget
 * transitions. `transition()` in transition.ts dispatches here.
 *
 * @module extensions/research-engine/transition-handlers
 */

import { registrableDomain } from "./fetcher.js";
import { combineJudgment, evaluateKbCovered } from "./guards.js";
import { stageEffects } from "./stage-effects.js";

import type { ResearchEvent } from "./events.js";
import type { Effect, ResearchStage, ResearchState, TransitionRecord } from "./state.js";

/** Result of a transition: next state + effects for the runner. */
export interface Transition {
  state: ResearchState;
  effects: Effect[];
}

/** Handler signature for one event type. */
type Handler = (prev: ResearchState, event: ResearchEvent, now: number) => Transition;

function dedupe(values: string[]): string[] {
  return [...new Set(values.filter((v) => v.length > 0))];
}

/** Commit an event to a stage with trace + llmErrorCount bookkeeping. */
export function commit(
  prev: ResearchState,
  to: ResearchStage,
  event: ResearchEvent,
  now: number,
  patch: Partial<ResearchState> = {},
): ResearchState {
  const record: TransitionRecord = { ts: now, from: prev.stage, event: event.type, to };
  return {
    ...prev,
    llmErrorCount: prev.llmErrorCount + ("llmErrors" in event ? (event.llmErrors ?? 0) : 0),
    ...patch,
    stage: to,
    trace: [...prev.trace, record],
  };
}

function enterStage(
  prev: ResearchState,
  to: ResearchStage,
  event: ResearchEvent,
  now: number,
  patch: Partial<ResearchState> = {},
): Transition {
  const state = commit(prev, to, event, now, patch);
  return { state, effects: [{ kind: "checkpoint" }, ...stageEffects(to, state)] };
}

function kbShortCircuit(
  prev: ResearchState,
  event: ResearchEvent,
  now: number,
  patch: Partial<ResearchState>,
): Transition {
  const state = commit(prev, "SYNTHESIZE", event, now, patch);
  return { state, effects: [{ kind: "checkpoint" }, { kind: "synthesize", source: "kb" }] };
}

function handleStart(
  _prev: ResearchState,
  event: ResearchEvent & { type: "start" },
  now: number,
): Transition {
  const state: ResearchState = {
    jobId: event.jobId,
    question: event.question,
    mode: event.mode,
    profile: event.profile,
    stage: "QUERY_GEN",
    cycle: 1,
    startedAt: event.startedAt,
    deadlineAt: event.startedAt + event.profile.deadlineMs,
    queries: [],
    kbDocs: [],
    kbSufficient: null,
    kbFreshRatio: null,
    kbCovered: false,
    candidates: [],
    lastRankCount: 0,
    fetches: [],
    summaries: event.seed?.summaries ?? [],
    visited: dedupe(event.seed?.visited ?? []),
    askedQuestions: dedupe(event.seed?.askedQuestions ?? []),
    coveredFacets: [],
    gaps: [],
    cycles: [],
    failures: [],
    llmErrorCount: 0,
    deadlineHit: false,
    degraded: false,
    trace: [{ ts: now, from: "IDLE", event: "start", to: "QUERY_GEN" }],
  };
  return { state, effects: [{ kind: "checkpoint" }, { kind: "query_gen" }] };
}

function handleQueriesGenerated(
  prev: ResearchState,
  event: ResearchEvent & { type: "queries_generated" },
  now: number,
): Transition {
  const kbCovered = evaluateKbCovered({
    kbDocs: event.kbDocs,
    kbFreshRatio: event.kbFreshRatio,
    kbSufficient: event.kbSufficient,
  });
  const patch = {
    queries: dedupe(event.queries),
    kbDocs: event.kbDocs,
    kbSufficient: event.kbSufficient,
    kbFreshRatio: event.kbFreshRatio,
    kbCovered,
    askedQuestions: dedupe([...prev.askedQuestions, ...event.queries]),
  };
  if (kbCovered) return kbShortCircuit(prev, event, now, patch);
  return enterStage(prev, "SEARCH", event, now, patch);
}

function handleSearchDone(
  prev: ResearchState,
  event: ResearchEvent & { type: "search_done" },
  now: number,
): Transition {
  const queries = dedupe(event.queries ?? [prev.question]);
  return enterStage(prev, "RANK", event, now, {
    candidates: event.candidates,
    kbDocs: event.kbDocs ?? prev.kbDocs,
    kbFreshRatio: event.kbFreshRatio ?? prev.kbFreshRatio,
    queries,
    coveredFacets: dedupe([...prev.coveredFacets, ...(event.coveredFacets ?? [])]),
    askedQuestions: dedupe([...prev.askedQuestions, ...queries]),
    failures: [...prev.failures, ...(event.failures ?? [])],
  });
}
function handleRanked(
  prev: ResearchState,
  event: ResearchEvent & { type: "ranked" },
  now: number,
): Transition {
  const visited = new Set(prev.visited);
  const urls = dedupe(event.candidates.map((c) => c.canonicalUrl).filter((u) => !visited.has(u)));
  const state = commit(prev, "FETCH", event, now, {
    candidates: event.candidates,
    lastRankCount: event.candidates.length,
  });
  return { state, effects: [{ kind: "checkpoint" }, { kind: "fetch", urls }] };
}

function handleFetched(
  prev: ResearchState,
  event: ResearchEvent & { type: "fetched" },
  now: number,
): Transition {
  const ok = event.records.some((r) => r.ok);
  return enterStage(prev, ok ? "SUMMARIZE" : "ASSESS", event, now, {
    fetches: [...prev.fetches, ...event.records],
  });
}

function handleSummarized(
  prev: ResearchState,
  event: ResearchEvent & { type: "summarized" },
  now: number,
): Transition {
  return enterStage(prev, "ASSESS", event, now, {
    summaries: [...prev.summaries, ...event.items],
    visited: dedupe([...prev.visited, ...prev.fetches.map((f) => f.canonicalUrl)]),
    failures: [...prev.failures, ...(event.failures ?? [])],
  });
}

function escalationEffects(decision: { reason: string }): Effect[] {
  return [
    { kind: "checkpoint" },
    { kind: "append_entry", customType: "research_escalation", data: decision },
    { kind: "notify", message: `research escalated: ${decision.reason}` },
  ];
}

function handleAssessed(
  prev: ResearchState,
  event: ResearchEvent & { type: "assessed" },
  now: number,
): Transition {
  const domainCount = new Set(
    prev.summaries.map((s) => registrableDomain(s.canonicalUrl)).filter(Boolean),
  ).size;
  const combined = combineJudgment(event.structural, event.judge, {
    sourceCount: prev.summaries.length,
    domainCount,
  });
  const cycleRecord = {
    cycle: prev.cycle,
    questions: prev.queries,
    candidates: prev.lastRankCount,
    fetched: prev.fetches.filter((f) => f.ok).length,
    summarized: prev.summaries.length,
  };
  const patch = { cycles: [...prev.cycles, cycleRecord], gaps: combined.gaps };

  if (prev.kbCovered) return kbShortCircuit(prev, event, now, patch);
  if (event.escalation?.escalate) {
    const state = commit(prev, "ESCALATED", event, now, {
      ...patch,
      escalation: event.escalation,
    });
    return { state, effects: escalationEffects(event.escalation) };
  }
  if (combined.sufficient) return enterStage(prev, "SYNTHESIZE", event, now, patch);
  if (prev.cycle < prev.profile.maxCycles) return enterStage(prev, "REFINE", event, now, patch);
  return enterStage(prev, "SYNTHESIZE", event, now, { ...patch, degraded: true });
}

function handleRefined(
  prev: ResearchState,
  event: ResearchEvent & { type: "refined" },
  now: number,
): Transition {
  return enterStage(prev, "QUERY_GEN", event, now, {
    cycle: prev.cycle + 1,
    queries: [],
    askedQuestions: dedupe([...prev.askedQuestions, ...event.questions]),
    coveredFacets: dedupe([...prev.coveredFacets, ...event.coveredFacets]),
  });
}

function handleSynthesized(
  prev: ResearchState,
  event: ResearchEvent & { type: "synthesized" },
  now: number,
): Transition {
  const hasError = event.error !== undefined && event.error.length > 0;
  const state = commit(prev, "WRITE_BACK", event, now, {
    synthesis: event.synthesis.length > 0 ? event.synthesis : undefined,
    synthesisError: hasError ? event.error : undefined,
    degraded: prev.degraded || hasError,
  });
  return { state, effects: [{ kind: "checkpoint" }, { kind: "writeback" }] };
}

function handleWritebackDone(
  prev: ResearchState,
  event: ResearchEvent & { type: "writeback_done" },
  now: number,
): Transition {
  const degraded = prev.degraded || prev.synthesisError !== undefined;
  const state = commit(prev, degraded ? "DONE_DEGRADED" : "DONE_SUFFICIENT", event, now, {
    writeback: event.writeback,
  });
  return { state, effects: [{ kind: "checkpoint" }] };
}

function handleEscalated(
  prev: ResearchState,
  event: ResearchEvent & { type: "escalated" },
  now: number,
): Transition {
  const state = commit(prev, "ESCALATED", event, now, { escalation: event.decision });
  return { state, effects: escalationEffects(event.decision) };
}

/** Dispatch table from event type to its pure handler. */
export const HANDLERS: Record<ResearchEvent["type"], Handler> = {
  start: handleStart as Handler,
  queries_generated: handleQueriesGenerated as Handler,
  search_done: handleSearchDone as Handler,
  ranked: handleRanked as Handler,
  fetched: handleFetched as Handler,
  summarized: handleSummarized as Handler,
  assessed: handleAssessed as Handler,
  refined: handleRefined as Handler,
  synthesized: handleSynthesized as Handler,
  writeback_done: handleWritebackDone as Handler,
  escalated: handleEscalated as Handler,
  aborted: (p, e, n) => {
    const state = commit(p, "CANCELLED", e, n);
    return { state, effects: [{ kind: "checkpoint" }] };
  },
};
