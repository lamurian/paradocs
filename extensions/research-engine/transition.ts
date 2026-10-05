/**
 * Pure FSM transition table for the research pipeline.
 *
 * `transition(state, event, now)` returns the next state plus the effects
 * the runner must execute for the new stage (as data — never executed
 * here). A budget guard runs on every transition entry; terminal states
 * swallow all further events. Per-event logic lives in
 * transition-handlers.ts to keep this dispatcher trivial.
 *
 * @module extensions/research-engine/transition
 */

import { TERMINAL_STAGES } from "./events.js";
import { HANDLERS, commit } from "./transition-handlers.js";

import type { ResearchEvent } from "./events.js";
import type { ResearchState } from "./state.js";
import type { Transition } from "./transition-handlers.js";

export { TERMINAL_STAGES } from "./events.js";
export { stageEffects } from "./stage-effects.js";
export type { ResearchEvent } from "./events.js";
export type { Transition } from "./transition-handlers.js";

/** abort event → CANCELLED with a checkpoint effect. */
function abortedTransition(prev: ResearchState, event: ResearchEvent, now: number): Transition {
  const state = commit(prev, "CANCELLED", event, now);
  return { state, effects: [{ kind: "checkpoint" }] };
}

/** Budget guard on transition entry → forced degraded SYNTHESIZE. */
function budgetTransition(prev: ResearchState, event: ResearchEvent, now: number): Transition {
  const state = commit(prev, "SYNTHESIZE", event, now, { deadlineHit: true, degraded: true });
  return { state, effects: [{ kind: "checkpoint" }, { kind: "synthesize", degraded: true }] };
}

/**
 * Apply one event to the research state.
 *
 * Pure: no I/O, no clock reads (the caller supplies `now`). Terminal
 * states return the state unchanged with zero effects.
 *
 * @param prev - Current state.
 * @param event - Event to apply.
 * @param now - Current epoch ms (budget guard + trace timestamps).
 * @returns Next state and effects for the runner.
 */
export function transition(prev: ResearchState, event: ResearchEvent, now: number): Transition {
  if (TERMINAL_STAGES.has(prev.stage)) return { state: prev, effects: [] };
  if (event.type === "aborted") return abortedTransition(prev, event, now);
  // Budget guard on every transition entry (except the initial start).
  if (prev.stage !== "IDLE" && now >= prev.deadlineAt) {
    return budgetTransition(prev, event, now);
  }
  return HANDLERS[event.type](prev, event, now);
}
