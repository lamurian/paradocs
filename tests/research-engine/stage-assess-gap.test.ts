/**
 * Gap tests for stage-assess.ts uncovered paths: the conditional judge
 * branch (success + failure with llmErrors), the synthesisFallback chain
 * (summaries / kbDocs+fetches / empty), and the stageSynthesize
 * deterministic fallback when the subagent fails. No subprocess spawns —
 * deps.llm is a stub.
 *
 * @module tests/research-engine/stage-assess-gap
 */

import { describe, it, expect, vi } from "vitest";

import {
  stageAssess,
  stageSynthesize,
  synthesisFallback,
} from "../../extensions/research-engine/stage-assess.js";

import type { ResearchState } from "../../extensions/research-engine/state.js";

/** Minimal research state covering the fields assess/synthesize read. */
function state(overrides: Partial<ResearchState> = {}): ResearchState {
  return {
    jobId: "j",
    question: "how do harnesses work",
    mode: "depth",
    profile: {
      name: "ask-deep",
      targetSources: 10,
      maxCycles: 3,
      deadlineMs: 600_000,
      minDomains: 3,
      requireAuthoritative: true,
      freshnessWindowDays: 365,
    },
    stage: "ASSESS",
    cycle: 2,
    startedAt: 0,
    deadlineAt: 1,
    queries: ["q1"],
    kbDocs: [],
    kbSufficient: null,
    kbFreshRatio: null,
    kbCovered: false,
    candidates: [],
    lastRankCount: 0,
    fetches: [],
    summaries: [],
    visited: [],
    askedQuestions: [],
    coveredFacets: [],
    gaps: [],
    cycles: [],
    failures: [],
    llmErrorCount: 0,
    deadlineHit: false,
    degraded: false,
    trace: [],
    ...overrides,
  };
}

const SUMMARY = {
  url: "https://s.example/1",
  title: "S",
  summary: "Summary body",
  canonicalUrl: "https://s.example/1",
  tier: 1,
} as never;

describe("stageAssess — conditional judge branch", () => {
  it("runs the judge when structural gates fail and adopts a valid judge result", async () => {
    const llm = vi.fn((..._args: unknown[]) =>
      Promise.resolve({ ok: true, value: { sufficient: true, gaps: [], sources: ["s"] } }),
    );
    const deps = { llm } as never;

    const ev = await stageAssess(state({ summaries: [SUMMARY] }), deps, () => 1);

    expect(llm).toHaveBeenCalledTimes(1);
    const call = llm.mock.calls[0][0] as { role: string; label: string };
    expect(call.role).toBe("judge");
    expect(call.label).toBe("Assessing…");
    expect(ev.type).toBe("assessed");
  });

  it("records a judge failure with llmErrors instead of throwing", async () => {
    const llm = vi.fn((..._args: unknown[]) => Promise.resolve({ ok: false, error: "judge down" }));
    const deps = { llm } as never;

    const ev = await stageAssess(state({ summaries: [SUMMARY] }), deps, () => 1);

    expect(ev.type).toBe("assessed");
    if (ev.type === "assessed") {
      expect(ev.llmErrors).toBe(1);
      expect(ev.judge?.error).toBe("judge down");
    }
  });
});

describe("synthesisFallback chain", () => {
  it("joins summaries when any exist", () => {
    const text = synthesisFallback(state({ summaries: [SUMMARY] }));
    expect(text).toContain("https://s.example/1");
    expect(text).toContain("Summary body");
  });

  it("falls back to KB doc titles and fetched source URLs", () => {
    const text = synthesisFallback(
      state({
        summaries: [],
        kbDocs: [{ title: "KB Doc", path: "Resources/kb.md" }],
        fetches: [
          { url: "https://f.example/a", canonicalUrl: "https://f.example/a", ok: true } as never,
          {
            url: "https://f.example/dead",
            canonicalUrl: "https://f.example/dead",
            ok: false,
          } as never,
        ],
      }),
    );
    expect(text).toContain("- KB: KB Doc (Resources/kb.md)");
    expect(text).toContain("https://f.example/a");
    expect(text).not.toContain("https://f.example/dead");
  });

  it("returns empty string when nothing was collected", () => {
    expect(synthesisFallback(state())).toBe("");
  });
});

describe("stageSynthesize — deterministic fallback", () => {
  it("falls back to joined summaries when the subagent fails", async () => {
    const llm = vi.fn((..._args: unknown[]) =>
      Promise.resolve({ ok: false, error: "synthesis down" }),
    );
    const deps = { llm } as never;

    const ev = await stageSynthesize(state({ summaries: [SUMMARY] }), deps);

    const judgeCall = llm.mock.calls[0][0] as { role: string; label: string };
    expect(judgeCall.role).toBe("synthesis");
    expect(judgeCall.label).toBe("Synthesizing…");
    expect(ev.type).toBe("synthesized");
    if (ev.type === "synthesized") {
      expect(ev.synthesis).toContain("https://s.example/1");
      expect(ev.error).toBe("synthesis down");
    }
  });

  it("falls back to kbDocs context when kbCovered is true and the subagent fails", async () => {
    const llm = vi.fn((..._args: unknown[]) => Promise.resolve({ ok: false, error: "down" }));
    const deps = { llm } as never;

    const ev = await stageSynthesize(
      state({
        kbCovered: true,
        kbDocs: [{ title: "KB Doc", path: "Resources/kb.md" }],
        summaries: [SUMMARY],
      }),
      deps,
    );

    const call = llm.mock.calls[0][0] as { user: string };
    expect(call.user).toContain("KB Doc (Resources/kb.md)");
    expect(ev.type).toBe("synthesized");
  });
});
