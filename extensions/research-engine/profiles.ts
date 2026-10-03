/**
 * Research profiles and deterministic thresholds.
 *
 * A profile bundles the stop-criteria budgets (sources / cycles / deadline)
 * with the sufficiency gate settings for one entry point. The first stop
 * criterion hit wins; degradation synthesizes from collected sources.
 *
 * @module extensions/research-engine/profiles
 */

import type { GateProfile } from "./state.js";

/** Rank-stage minimum below which candidates are considered too thin. */
export const MIN_CANDIDATES = 8;

/** Minimum fetch success rate for the pipeline to count as healthy. */
export const FETCH_RATE_MIN = 0.5;

/** Fetch p50 latency ceiling (ms) for the pipeline to count as healthy. */
export const FETCH_P50_MAX_MS = 20_000;

/** LLM error budget: any error marks the pipeline unhealthy. */
export const LLM_ERROR_BUDGET = 0;

/** /research — thorough, overarchiving scrutiny of a topic. */
export const RESEARCH_PROFILE: GateProfile = {
  name: "research",
  targetSources: 15,
  maxCycles: 5,
  deadlineMs: 600_000,
  minDomains: 4,
  requireAuthoritative: true,
  freshnessWindowDays: 365,
};

/** /ask deep — focused research with moderate budgets. */
export const ASK_DEEP_PROFILE: GateProfile = {
  name: "ask-deep",
  targetSources: 10,
  maxCycles: 3,
  deadlineMs: 600_000,
  minDomains: 3,
  requireAuthoritative: true,
  freshnessWindowDays: 365,
};

/** ask tool quick mode — fast, in-tool lookup with minimal budgets. */
export const ASK_QUICK_PROFILE: GateProfile = {
  name: "ask-quick",
  targetSources: 5,
  maxCycles: 1,
  deadlineMs: 90_000,
  minDomains: 2,
  requireAuthoritative: false,
  freshnessWindowDays: null,
};
