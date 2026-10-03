/**
 * Stage-effect planning: the effects required to execute a stage's work.
 *
 * Used both by transitions (declaring the next stage's work) and by
 * checkpoint resume (completed stages contribute nothing).
 *
 * @module extensions/research-engine/stage-effects
 */

import { buildSummarizeEffects } from "./effects.js";

import type { Effect, ResearchStage, ResearchState } from "./state.js";

function dedupe(values: string[]): string[] {
  return [...new Set(values.filter((v) => v.length > 0))];
}

/**
 * Effects required to execute the work of a stage.
 *
 * @param stage - The stage to plan effects for.
 * @param state - Current research state (fetch records feed SUMMARIZE).
 * @returns Effect descriptors for the stage.
 */
export function stageEffects(stage: ResearchStage, state: ResearchState): Effect[] {
  switch (stage) {
    case "QUERY_GEN":
      return [{ kind: "query_gen" }];
    case "SEARCH":
      return [{ kind: "search" }];
    case "RANK":
      return [{ kind: "rank" }];
    case "FETCH": {
      const visited = new Set(state.visited);
      const urls = dedupe(
        state.candidates.map((c) => c.canonicalUrl).filter((u) => !visited.has(u)),
      );
      return [{ kind: "fetch", urls }];
    }
    case "SUMMARIZE":
      return buildSummarizeEffects(state.fetches);
    case "ASSESS":
      return [{ kind: "assess" }];
    case "REFINE":
      return [{ kind: "refine" }];
    case "SYNTHESIZE":
      return [{ kind: "synthesize" }];
    case "WRITE_BACK":
      return [{ kind: "writeback" }];
    default:
      return [];
  }
}
