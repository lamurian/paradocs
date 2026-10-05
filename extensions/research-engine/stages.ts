/**
 * Stage dispatcher: routes the current FSM stage to its executor, and
 * enforces the subagent circuit breaker.
 *
 * The breaker counts consecutive subagent failures within one stage
 * execution (success resets the counter). After 3 consecutive failures
 * the stage aborts to a degraded synthesized event carrying the last
 * real error message — remaining calls short-circuit without spawning.
 *
 * @module extensions/research-engine/stages
 */

import { stageAssess, stageSynthesize, stageWriteBack } from "./stage-assess.js";
import { stageQueryGen, stageRefine } from "./stage-queries.js";
import { stageFetch, stageRank, stageSearch } from "./stage-sources.js";
import { stageSummarize } from "./stage-summarize.js";

import type { ResearchEvent } from "./events.js";
import type { LlmCallOutcome, ResearchDeps, SearchSubagentOutcome } from "./research-deps.js";
import type { ResearchState } from "./state.js";

/** Consecutive subagent failures that abort a stage. */
export const BREAKER_LIMIT = 3;

/** Consecutive-failure breaker for one stage execution. */
export interface StageBreaker {
  /** Record one outcome; returns true when the breaker trips. */
  record(ok: boolean, error?: string): boolean;
  /** Whether the breaker has tripped. */
  readonly tripped: boolean;
  /** Last real failure message. */
  readonly error: string;
}

/**
 * Create a consecutive-failure breaker.
 *
 * @param limit - Failures in a row that trip the breaker.
 * @returns A fresh breaker (tripped resets on the next success).
 */
export function createBreaker(limit: number = BREAKER_LIMIT): StageBreaker {
  let consecutive = 0;
  let lastError = "";
  return {
    record(ok: boolean, error?: string): boolean {
      if (ok) {
        consecutive = 0;
        return false;
      }
      consecutive++;
      // Freeze the message at trip time: in-flight failures after the
      // trip must not overwrite the error that aborted the run.
      if (error && error.length > 0 && consecutive <= limit) lastError = error;
      return consecutive >= limit;
    },
    get tripped(): boolean {
      return consecutive >= limit;
    },
    get error(): string {
      return lastError;
    },
  };
}

function errMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * Wrap deps with breaker-guarded subagent calls.
 *
 * Once tripped, further calls short-circuit with the breaker error and
 * never spawn a subprocess.
 *
 * @param deps - Injected I/O surface.
 * @param breaker - Stage breaker recording every outcome.
 * @returns Deps whose llm/searchSubagent feed the breaker.
 */
export function guardDepsWithBreaker(deps: ResearchDeps, breaker: StageBreaker): ResearchDeps {
  return {
    ...deps,
    llm: async (input) => {
      if (breaker.tripped) return { ok: false, error: `circuit breaker: ${breaker.error}` };
      let res: LlmCallOutcome;
      try {
        res = await deps.llm(input);
      } catch (e: unknown) {
        res = { ok: false, error: errMessage(e) };
      }
      breaker.record(res.ok, res.ok ? undefined : res.error);
      return res;
    },
    searchSubagent: async (input) => {
      if (breaker.tripped) return { ok: false, error: `circuit breaker: ${breaker.error}` };
      let res: SearchSubagentOutcome;
      try {
        res = await deps.searchSubagent(input);
      } catch (e: unknown) {
        res = { ok: false, error: errMessage(e) };
      }
      breaker.record(res.ok, res.ok ? undefined : res.error);
      return res;
    },
  };
}

/**
 * Execute the work of the state's current stage, returning the event
 * that drives the next transition. Tripped breakers abort to a
 * degraded synthesized event carrying the last real error.
 *
 * @param state - Current research state.
 * @param deps - Injected I/O surface.
 * @param now - Clock.
 * @returns The stage-completion event.
 */
export async function runStage(
  state: ResearchState,
  deps: ResearchDeps,
  now: () => number,
): Promise<ResearchEvent> {
  const breaker = createBreaker();
  const guarded = guardDepsWithBreaker(deps, breaker);
  const event = await runStageExecutor(state, guarded, now);
  if (breaker.tripped) {
    return {
      type: "synthesized",
      synthesis: "",
      error: breaker.error,
      llmErrors: 1,
    };
  }
  return event;
}

/** Dispatch the current stage to its executor (no breaker wrapping). */
async function runStageExecutor(
  state: ResearchState,
  deps: ResearchDeps,
  now: () => number,
): Promise<ResearchEvent> {
  switch (state.stage) {
    case "QUERY_GEN":
      return stageQueryGen(state, deps, now);
    case "SEARCH":
      return stageSearch(state, deps);
    case "RANK":
      return stageRank(state, deps);
    case "FETCH":
      return stageFetch(state, deps, now);
    case "SUMMARIZE":
      return stageSummarize(state, deps);
    case "ASSESS":
      return stageAssess(state, deps, now);
    case "REFINE":
      return stageRefine(state, deps);
    case "SYNTHESIZE":
      return stageSynthesize(state, deps);
    case "WRITE_BACK":
      return stageWriteBack(state, deps);
    default:
      // Safety: non-executable stage (terminal or IDLE) → abort the run.
      return { type: "aborted" };
  }
}

export type { ResearchDeps } from "./research-deps.js";
export { DEFAULT_STAGE_MESSAGES } from "./research-deps.js";
