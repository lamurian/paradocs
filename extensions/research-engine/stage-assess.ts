/**
 * ASSESS, SYNTHESIZE, and WRITE_BACK stage executors.
 *
 * @module extensions/research-engine/stage-assess
 */

import { parseJudge, parseSynthesis, prompt } from "./effects.js";
import { registrableDomain } from "./fetcher.js";
import { combineJudgment, evaluateEscalation, evaluateGates } from "./guards.js";

import type { ResearchEvent } from "./events.js";
import type { ResearchDeps } from "./research-deps.js";
import type { DecisionRecord, JudgeResult, ResearchState, StructuralResult } from "./state.js";
import type { ResearchSource } from "./types.js";

/** p50 of fetch durations (0 when no records). */
function fetchP50(state: ResearchState): number {
  const durations = state.fetches.map((f) => f.durationMs ?? 0).sort((a, b) => a - b);
  return durations.length > 0 ? durations[Math.floor(durations.length / 2)] : 0;
}

/**
 * ASSESS: structural gates, conditional judge, deterministic escalation.
 *
 * @param state - Current research state.
 * @param deps - Injected I/O surface.
 * @param now - Clock.
 * @returns assessed event.
 */
export async function stageAssess(
  state: ResearchState,
  deps: ResearchDeps,
  now: () => number,
): Promise<ResearchEvent> {
  const fetchTier = new Map(
    state.fetches.filter((f) => f.ok).map((f) => [f.canonicalUrl, { tier: f.tier, year: f.year }]),
  );
  const structural: StructuralResult = evaluateGates(
    state.summaries,
    fetchTier,
    state.profile,
    now(),
  );

  let judge: JudgeResult | null = null;
  let llmErrors = 0;
  const judgeNeeded = !structural.pass || structural.indeterminate.length > 0;
  if (judgeNeeded) {
    const gists = state.summaries
      .map((s) => `- ${s.url}${s.title ? ` (${s.title})` : ""}: ${s.summary.slice(0, 200)}`)
      .join("\n");
    const res = await deps.llm({
      system: prompt("judge"),
      user: `Question: ${state.question}\n\nCollected summaries:\n${gists || "(none)"}\n\nKB docs: ${
        state.kbDocs.map((d) => d.title).join("; ") || "none"
      }`,
      parse: (t) => parseJudge(t),
      timeoutMs: deps.llmTimeoutMs,
      label: "Assessing…",
    });
    if (res.ok && res.value && typeof res.value === "object") {
      judge = res.value as JudgeResult;
    } else {
      judge = {
        sufficient: false,
        gaps: [],
        error: res.ok ? "invalid judge response" : (res.error ?? "judge call failed"),
      };
      llmErrors = 1;
    }
  }

  const domains = new Set(
    state.summaries.map((s) => registrableDomain(s.canonicalUrl)).filter(Boolean),
  ).size;
  const combined = combineJudgment(structural, judge, {
    sourceCount: state.summaries.length,
    domainCount: domains,
  });

  let escalation: DecisionRecord | undefined;
  if (deps.allowEscalation) {
    const attempts = state.fetches.length;
    const okCount = state.fetches.filter((f) => f.ok).length;
    escalation = evaluateEscalation({
      sufficient: combined.sufficient,
      kbCovered: state.kbCovered,
      llmErrorCount: state.llmErrorCount + llmErrors,
      fetchAttempts: attempts,
      fetchOk: okCount,
      fetchP50Ms: fetchP50(state),
      lastRankCount: state.lastRankCount,
      summarized: state.summaries.length,
      distinctDomains: domains,
      deadlineHit: state.deadlineHit || now() >= state.deadlineAt,
      targetSources: state.profile.targetSources,
      minDomains: state.profile.minDomains,
    });
  }

  return { type: "assessed", structural, judge, escalation, llmErrors };
}

/**
 * SYNTHESIZE: final answer from summaries or KB gists.
 *
 * @param state - Current research state.
 * @param deps - Injected I/O surface.
 * @returns synthesized event (error surfaced, never swallowed).
 */
export async function stageSynthesize(
  state: ResearchState,
  deps: ResearchDeps,
): Promise<ResearchEvent> {
  const context = state.kbCovered
    ? state.kbDocs.map((d) => `- ${d.title} (${d.path})`).join("\n")
    : state.summaries
        .map((s) => `- ${s.url}${s.title ? ` (${s.title})` : ""}: ${s.summary}`)
        .join("\n");
  const res = await deps.llm({
    system: prompt("synthesis"),
    user: `Question: ${state.question}\n\nSources:\n${context || "(none collected)"}`,
    parse: (t) => parseSynthesis(t),
    timeoutMs: deps.llmTimeoutMs,
    label: "Synthesizing…",
  });
  if (!res.ok || typeof res.value !== "string" || res.value.trim().length === 0) {
    return {
      type: "synthesized",
      synthesis: "",
      error: res.ok ? "empty synthesis response" : (res.error ?? "synthesis call failed"),
      llmErrors: res.ok ? 0 : 1,
    };
  }
  return { type: "synthesized", synthesis: res.value };
}

/**
 * WRITE_BACK: build metadata-bearing sources and run the KB write-back.
 *
 * @param state - Current research state.
 * @param deps - Injected I/O surface.
 * @returns writeback_done event (failures surfaced as skipped lines).
 */
export async function stageWriteBack(
  state: ResearchState,
  deps: ResearchDeps,
): Promise<ResearchEvent> {
  const sources: ResearchSource[] = state.summaries.map((s) => {
    const rec = state.fetches.find((f) => f.canonicalUrl === s.canonicalUrl);
    return {
      url: s.url,
      snippet: s.summary,
      title: s.title ?? rec?.title,
      authors: rec?.authors,
      year: rec?.year,
      tier: rec?.tier,
    };
  });
  try {
    const writeback = await deps.writeBack({ sources, questions: state.askedQuestions });
    return { type: "writeback_done", writeback };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      type: "writeback_done",
      writeback: { created: [], updated: [], skipped: [`write-back failed: ${msg.slice(0, 200)}`] },
    };
  }
}
