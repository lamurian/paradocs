/**
 * Research orchestrator runner: drives the pure FSM, executes stage
 * effects via injected deps, checkpoints state after every transition,
 * and surfaces per-stage progress.
 *
 * @module extensions/research-engine/orchestrator
 */

import { saveCheckpoint } from "./checkpoint.js";
import { runStage, DEFAULT_STAGE_MESSAGES } from "./stages.js";
import { TERMINAL_STAGES, transition } from "./transition.js";

import type { ResearchEvent } from "./events.js";
import type { ResearchDeps } from "./research-deps.js";
import type { Effect, GateProfile, ResearchState, SummaryItem } from "./state.js";

export { DEFAULT_STAGE_MESSAGES } from "./research-deps.js";
export type { ResearchDeps, LlmCallInput, LlmCallOutcome } from "./research-deps.js";

/** Input for one research run. */
export interface RunResearchInput {
  question: string;
  mode: "breadth" | "depth";
  profile: GateProfile;
  jobId?: string;
  seed?: { visited?: string[]; summaries?: SummaryItem[]; askedQuestions?: string[] };
}

function applySideEffects(effects: Effect[], state: ResearchState, deps: ResearchDeps): void {
  for (const eff of effects) {
    if (eff.kind === "checkpoint") saveCheckpoint(deps.knowledgeDir, state);
    else if (eff.kind === "append_entry") deps.appendEntry?.(eff.customType, eff.data);
    else if (eff.kind === "notify") deps.notify?.(eff.message);
  }
}

/**
 * Run the full research pipeline to a terminal state.
 *
 * The loop is: current stage → stage executor → transition → side
 * effects (checkpoint / appendEntry / notify) → next stage. Budgets are
 * enforced by the transition entry guard; the abort signal cancels between
 * stages. Checkpoints land in `KNOWLEDGE_DIR/.research/<jobId>.json`.
 *
 * @param deps - Injected I/O surface (LLM, search, fetch, write-back).
 * @param input - Question, mode, profile, optional job id and seed state.
 * @returns The terminal research state.
 */
export async function runResearch(
  deps: ResearchDeps,
  input: RunResearchInput,
): Promise<ResearchState> {
  const now = deps.now ?? Date.now;
  const jobId =
    input.jobId ?? `research-${now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

  const startEvent: ResearchEvent = {
    type: "start",
    question: input.question,
    mode: input.mode,
    profile: input.profile,
    jobId,
    startedAt: now(),
    seed: input.seed,
  };
  let t = transition({ stage: "IDLE" } as ResearchState, startEvent, now());
  let state = t.state;
  applySideEffects(t.effects, state, deps);

  while (!TERMINAL_STAGES.has(state.stage)) {
    if (deps.signal?.aborted) {
      t = transition(state, { type: "aborted" }, now());
      state = t.state;
      applySideEffects(t.effects, state, deps);
      break;
    }
    deps.onProgress?.(state.stage, DEFAULT_STAGE_MESSAGES[state.stage] ?? state.stage);
    const event = await runStage(state, deps, now);
    t = transition(state, event, now());
    state = t.state;
    applySideEffects(t.effects, state, deps);
  }

  return state;
}
