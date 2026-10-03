/**
 * Stage dispatcher: routes the current FSM stage to its executor.
 *
 * @module extensions/research-engine/stages
 */

import { stageAssess, stageSynthesize, stageWriteBack } from "./stage-assess.js";
import { stageQueryGen, stageRefine } from "./stage-queries.js";
import { stageFetch, stageRank, stageSearch } from "./stage-sources.js";
import { stageSummarize } from "./stage-summarize.js";

import type { ResearchEvent } from "./events.js";
import type { ResearchDeps } from "./research-deps.js";
import type { ResearchState } from "./state.js";

/**
 * Execute the work of the state's current stage, returning the event
 * that drives the next transition.
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
