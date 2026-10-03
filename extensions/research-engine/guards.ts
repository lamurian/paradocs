/**
 * Deterministic sufficiency gates (Layer 1) and escalation guard.
 *
 * All functions here are pure predicates over `ResearchState` — no I/O,
 * no LLM calls. LLM-derived data (judge verdicts, kbSufficient) may appear
 * as validated inputs, but the decision logic itself is arithmetic.
 *
 * @module extensions/research-engine/guards
 */

import { isAuthoritative, registrableDomain } from "./fetcher.js";
import { FETCH_P50_MAX_MS, FETCH_RATE_MIN, LLM_ERROR_BUDGET, MIN_CANDIDATES } from "./profiles.js";

import type {
  DecisionRecord,
  GateProfile,
  GateResult,
  JudgeResult,
  KbDocGist,
  StructuralResult,
} from "./state.js";

// ── kbCovered ─────────────────────────────────────────────────────────

/** Inputs for the deterministic KB-covered verdict. */
export interface KbCoverInput {
  kbDocs: KbDocGist[];
  kbFreshRatio: number | null;
  kbSufficient: boolean | null;
}

/**
 * Deterministic KB-covered verdict: dense, fresh KB results plus a
 * positive (validated) LLM verdict. A null verdict is conservative.
 *
 * @param input - KB doc count, freshness ratio, and LLM verdict.
 * @returns True when the KB already answers the question.
 */
export function evaluateKbCovered(input: KbCoverInput): boolean {
  return (
    input.kbDocs.length >= 3 && (input.kbFreshRatio ?? 0) >= 0.6 && input.kbSufficient === true
  );
}

// ── Layer-1 structural gates ──────────────────────────────────────────

function freshnessYears(windowDays: number): number {
  return Math.max(1, Math.floor(windowDays / 365));
}

/**
 * Evaluate the four structural sufficiency gates over state.
 *
 * SOURCES — summarized count vs target. DOMAINS — distinct registrable
 * domains vs minDomains. AUTHORITY — ≥1 tier-1/2 or academic source when
 * required. FRESHNESS — ≥70% of *datable* sources within the window;
 * INDETERMINATE when under half the sources are datable.
 *
 * @param summaries - Canonical URLs of summarized sources.
 * @param fetchTier - Map canonicalUrl → tier (and authority) lookup.
 * @param profile - Gate profile with thresholds.
 * @param now - Current epoch ms (for the freshness year).
 * @returns Structural gate result with pass/failed/indeterminate codes.
 */
export function evaluateGates(
  summaries: Array<{ canonicalUrl: string; url: string }>,
  fetchTier: Map<string, { tier?: number; year?: number }>,
  profile: GateProfile,
  now: number,
): StructuralResult {
  const gates: GateResult[] = [];

  // SOURCES
  gates.push({
    code: "SOURCES",
    status: summaries.length >= profile.targetSources ? "pass" : "fail",
    detail: `${summaries.length}/${profile.targetSources} sources`,
  });

  // DOMAINS
  const domains = new Set(summaries.map((s) => registrableDomain(s.canonicalUrl)).filter(Boolean));
  gates.push({
    code: "DOMAINS",
    status: domains.size >= profile.minDomains ? "pass" : "fail",
    detail: `only ${domains.size} domains represented (min ${profile.minDomains})`,
  });

  // AUTHORITY
  if (!profile.requireAuthoritative) {
    gates.push({ code: "AUTHORITY", status: "pass", detail: "not required" });
  } else {
    const hasAuth = summaries.some((s) => {
      const rec = fetchTier.get(s.canonicalUrl);
      return isAuthoritative(s.url, rec?.tier);
    });
    gates.push({
      code: "AUTHORITY",
      status: hasAuth ? "pass" : "fail",
      detail: hasAuth ? "authoritative source present" : "no authoritative (tier-1/2) source",
    });
  }

  // FRESHNESS
  if (profile.freshnessWindowDays === null) {
    gates.push({ code: "FRESHNESS", status: "pass", detail: "ignored" });
  } else {
    const nowYear = new Date(now).getUTCFullYear();
    const minYear = nowYear - freshnessYears(profile.freshnessWindowDays);
    const datable = summaries
      .map((s) => fetchTier.get(s.canonicalUrl)?.year)
      .filter((y): y is number => typeof y === "number");
    if (summaries.length > 0 && datable.length / summaries.length < 0.5) {
      gates.push({
        code: "FRESHNESS",
        status: "indeterminate",
        detail: "freshness unverifiable (too few datable sources)",
      });
    } else if (datable.length === 0) {
      gates.push({ code: "FRESHNESS", status: "indeterminate", detail: "no datable sources" });
    } else {
      const fresh = datable.filter((y) => y >= minYear).length;
      const ratio = fresh / datable.length;
      gates.push({
        code: "FRESHNESS",
        status: ratio >= 0.7 ? "pass" : "fail",
        detail: `${Math.round(ratio * 100)}% of datable sources within window`,
      });
    }
  }

  const failed = gates.filter((g) => g.status === "fail").map((g) => g.code);
  const indeterminate = gates.filter((g) => g.status === "indeterminate").map((g) => g.code);
  return { pass: failed.length === 0, gates, failed, indeterminate };
}

// ── Gap synthesis & judge combination ─────────────────────────────────

/**
 * Synthesize gap descriptions from failed/indeterminate gate codes.
 *
 * @param structural - Layer-1 gate result.
 * @param sourceCount - Summarized source count (for SOURCES wording).
 * @param domainCount - Distinct domain count (for DOMAINS wording).
 * @returns Human-readable gap list.
 */
export function synthesizeGaps(
  structural: StructuralResult,
  sourceCount = 0,
  domainCount = 0,
): string[] {
  const gaps: string[] = [];
  for (const code of structural.failed) {
    if (code === "SOURCES") gaps.push(`only ${sourceCount} sources collected`);
    else if (code === "DOMAINS") gaps.push(`only ${domainCount} domains represented`);
    else if (code === "AUTHORITY") gaps.push("no authoritative (tier-1/2) source");
    else if (code === "FRESHNESS") gaps.push("sources too old for topic freshness window");
  }
  for (const code of structural.indeterminate) {
    if (code === "FRESHNESS") gaps.push("freshness unverifiable (too few datable sources)");
  }
  return gaps;
}

/**
 * Combine Layer-1 structure with the Layer-2 judge.
 *
 * Formula: structural pass → sufficient (judge never consulted). Structural
 * fail → never sufficient (judge can only collect gaps). Indeterminate →
 * the judge decides. Judge errors degrade to insufficient with synthesized gaps.
 *
 * @param structural - Layer-1 result.
 * @param judge - Judge verdict, when one was collected.
 * @param counts - Source/domain counts for gap wording.
 * @returns Final sufficiency verdict and gap list.
 */
export function combineJudgment(
  structural: StructuralResult,
  judge: JudgeResult | null | undefined,
  counts?: { sourceCount: number; domainCount: number },
): { sufficient: boolean; gaps: string[] } {
  if (structural.pass && structural.indeterminate.length === 0) {
    return { sufficient: true, gaps: [] };
  }
  const judgeOk = judge !== null && judge !== undefined && !judge.error;
  // Structural pass with indeterminate gates — a positive judge decides.
  if (structural.pass && judgeOk && judge.sufficient === true) {
    return { sufficient: true, gaps: judge.gaps ?? [] };
  }
  // Structural fail → never sufficient; the judge only collects gaps.
  return { sufficient: false, gaps: resolveGaps(structural, judge, judgeOk, counts) };
}

/**
 * Gap list for an insufficient verdict: judge gaps when usable,
 * otherwise gaps synthesized from the failed/indeterminate gates.
 */
function resolveGaps(
  structural: StructuralResult,
  judge: JudgeResult | null | undefined,
  judgeOk: boolean,
  counts?: { sourceCount: number; domainCount: number },
): string[] {
  if (judgeOk && judge?.gaps?.length) return judge.gaps;
  return synthesizeGaps(structural, counts?.sourceCount ?? 0, counts?.domainCount ?? 0);
}

// ── Escalation guard ──────────────────────────────────────────────────

/** Inputs for the deterministic escalation decision. */
export interface EscalationInput {
  sufficient: boolean;
  kbCovered: boolean;
  llmErrorCount: number;
  fetchAttempts: number;
  fetchOk: number;
  fetchP50Ms: number;
  lastRankCount: number;
  summarized: number;
  distinctDomains: number;
  deadlineHit: boolean;
  targetSources: number;
  minDomains: number;
}

/**
 * Evaluate the escalation guard: escalate on scope shortfall only, never
 * on pipeline health. Returns a DecisionRecord with a full guard snapshot.
 *
 * @param input - Guard inputs derived from state.
 * @returns DecisionRecord with escalate flag, reason, and guard snapshot.
 */
export function evaluateEscalation(input: EscalationInput): DecisionRecord {
  const fetchRate = input.fetchAttempts > 0 ? input.fetchOk / input.fetchAttempts : 1;
  const guards: Record<string, unknown> = {
    sufficient: input.sufficient,
    kbCovered: input.kbCovered,
    llmErrors: input.llmErrorCount,
    fetchRate: Number(fetchRate.toFixed(2)),
    fetchP50Ms: input.fetchP50Ms,
    lastRankCount: input.lastRankCount,
    summarized: input.summarized,
    distinctDomains: input.distinctDomains,
    deadlineHit: input.deadlineHit,
  };
  const base = (escalate: boolean, reason: string): DecisionRecord => ({
    from: "ASSESS",
    escalate,
    reason,
    guards,
  });

  if (input.sufficient) return base(false, "SUFFICIENT");
  if (input.kbCovered) return base(false, "KB_COVERED");

  if (input.llmErrorCount > LLM_ERROR_BUDGET) {
    return base(false, `MODEL_FAILURES (${input.llmErrorCount} LLM error(s))`);
  }
  if (fetchRate < FETCH_RATE_MIN) {
    return base(false, `FETCH_FAILURES (${Math.round(fetchRate * 100)}% success)`);
  }
  if (input.fetchP50Ms > FETCH_P50_MAX_MS) {
    return base(false, `SLOW_PIPELINE (p50 ${input.fetchP50Ms}ms)`);
  }

  if (input.lastRankCount > 0 && input.lastRankCount < MIN_CANDIDATES) {
    return base(true, `THIN_CANDIDATES (${input.lastRankCount}<${MIN_CANDIDATES} candidates)`);
  }
  if (input.deadlineHit) {
    return base(true, "VOLUME_EXHAUSTED (deadline reached with healthy pipeline)");
  }
  if (input.summarized < input.targetSources || input.distinctDomains < input.minDomains) {
    return base(
      true,
      `LOW_COVERAGE (${input.summarized}<${input.targetSources} sources, ` +
        `${input.distinctDomains}<${input.minDomains} domains)`,
    );
  }
  return base(false, "NO_SHORTFALL");
}
