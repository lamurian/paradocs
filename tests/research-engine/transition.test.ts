/**
 * Tests for the pure FSM transition table: full-cycle driving (T1),
 * budget guard + terminals + abort, kbCovered short-circuit (T5),
 * cross-cycle visited dedupe (T7).
 *
 * @module tests/research-engine/transition.test
 */

import { describe, it, expect } from "vitest";

import { ASK_DEEP_PROFILE } from "../../extensions/research-engine/profiles.js";
import { transition } from "../../extensions/research-engine/transition.js";

import type {
  Candidate,
  FetchRecord,
  GateProfile,
  ResearchState,
  StructuralResult,
  SummaryItem,
} from "../../extensions/research-engine/state.js";
import type { ResearchEvent } from "../../extensions/research-engine/transition.js";

const T0 = Date.parse("2026-10-02T10:00:00Z");

function profile(overrides: Partial<GateProfile> = {}): GateProfile {
  return { ...ASK_DEEP_PROFILE, ...overrides };
}

/** Drive a fresh state through an optional prefix of events. */
function drive(events: ResearchEvent[] = [], p: GateProfile = profile()): ResearchState {
  let { state } = transition(
    { stage: "IDLE" } as ResearchState,
    {
      type: "start",
      question: "q",
      mode: "breadth",
      profile: p,
      jobId: "job-1",
      startedAt: T0,
    },
    T0,
  );
  for (const e of events) state = transition(state, e, T0).state;
  return state;
}

function cand(url: string, query = "q1"): Candidate {
  return { url, canonicalUrl: url, tier: 3, query };
}

function rec(url: string, content: string, ok = true): FetchRecord {
  return {
    url,
    canonicalUrl: url,
    ok,
    content: ok ? content : undefined,
    error: ok ? undefined : "boom",
    fetchedAt: T0,
  };
}

function item(url: string, summary = "s"): SummaryItem {
  return { url, canonicalUrl: url, summary };
}

const GEN: ResearchEvent = {
  type: "queries_generated",
  queries: ["q1"],
  kbDocs: [],
  kbSufficient: null,
  kbFreshRatio: null,
};
const PASS_STRUCTURAL: StructuralResult = { pass: true, gates: [], failed: [], indeterminate: [] };

describe("transition — full cycle (T1)", () => {
  it("should drive IDLE→QUERY_GEN→SEARCH→RANK→FETCH→SUMMARIZE→ASSESS→SYNTHESIZE", () => {
    let r = transition(
      { stage: "IDLE" } as ResearchState,
      {
        type: "start",
        question: "q",
        mode: "breadth",
        profile: profile(),
        jobId: "job-1",
        startedAt: T0,
      },
      T0,
    );
    expect(r.state.stage).toBe("QUERY_GEN");
    expect(r.effects.map((e) => e.kind)).toEqual(["checkpoint", "query_gen"]);

    r = transition(r.state, GEN, T0);
    expect(r.state.stage).toBe("SEARCH");
    expect(r.effects.map((e) => e.kind)).toEqual(["checkpoint", "search"]);

    r = transition(
      r.state,
      {
        type: "search_done",
        candidates: [cand("https://a.com/1"), cand("https://b.com/2")],
      },
      T0,
    );
    expect(r.state.stage).toBe("RANK");
    expect(r.effects.map((e) => e.kind)).toEqual(["checkpoint", "rank"]);

    r = transition(
      r.state,
      {
        type: "ranked",
        candidates: [cand("https://a.com/1"), cand("https://b.com/2")],
      },
      T0,
    );
    expect(r.state.stage).toBe("FETCH");
    expect(r.effects[1]).toEqual({ kind: "fetch", urls: ["https://a.com/1", "https://b.com/2"] });

    r = transition(
      r.state,
      { type: "fetched", records: [rec("https://a.com/1", "x".repeat(1000))] },
      T0,
    );
    expect(r.state.stage).toBe("SUMMARIZE");
    expect(r.effects[1]).toMatchObject({ kind: "summarize", mode: "whole" });

    r = transition(r.state, { type: "summarized", items: [item("https://a.com/1")] }, T0);
    expect(r.state.stage).toBe("ASSESS");
    expect(r.effects.map((e) => e.kind)).toEqual(["checkpoint", "assess"]);

    r = transition(r.state, { type: "assessed", structural: PASS_STRUCTURAL }, T0);
    expect(r.state.stage).toBe("SYNTHESIZE");
    expect(r.effects.map((e) => e.kind)).toEqual(["checkpoint", "synthesize"]);

    // trace recorded every step
    expect(r.state.trace.map((t) => t.to)).toEqual([
      "QUERY_GEN",
      "SEARCH",
      "RANK",
      "FETCH",
      "SUMMARIZE",
      "ASSESS",
      "SYNTHESIZE",
    ]);
  });

  it("should force degraded SYNTHESIZE when the deadline is exceeded on entry (FETCH)", () => {
    const p = profile({ deadlineMs: 1000 });
    const state = drive(
      [
        GEN,
        { type: "search_done", candidates: [cand("https://a.com/1")] },
        { type: "ranked", candidates: [cand("https://a.com/1")] },
      ],
      p,
    );

    const { state: after, effects } = transition(
      state,
      {
        type: "fetched",
        records: [rec("https://a.com/1", "content")],
      },
      T0 + 5000,
    );
    expect(after.stage).toBe("SYNTHESIZE");
    expect(after.degraded).toBe(true);
    expect(after.deadlineHit).toBe(true);
    expect(effects).toContainEqual({ kind: "synthesize", degraded: true });
  });

  it("should yield CANCELLED with a checkpoint effect on abort from a non-terminal state", () => {
    const state = drive([GEN, { type: "search_done", candidates: [] }]);
    const { state: cancelled, effects } = transition(state, { type: "aborted" }, T0);
    expect(cancelled.stage).toBe("CANCELLED");
    expect(effects).toEqual([{ kind: "checkpoint" }]);
  });
});

describe("transition — kbCovered short-circuit (T5)", () => {
  it("should short-circuit from QUERY_GEN to SYNTHESIZE(kb) with no search/fetch effects", () => {
    const started = transition(
      { stage: "IDLE" } as ResearchState,
      {
        type: "start",
        question: "q",
        mode: "breadth",
        profile: profile(),
        jobId: "j",
        startedAt: T0,
      },
      T0,
    );
    const r = transition(
      started.state,
      {
        type: "queries_generated",
        queries: ["q1"],
        kbDocs: [
          { title: "A", path: "a.md" },
          { title: "B", path: "b.md" },
          { title: "C", path: "c.md" },
          { title: "D", path: "d.md" },
        ],
        kbSufficient: true,
        kbFreshRatio: 0.75,
      },
      T0,
    );
    expect(r.state.stage).toBe("SYNTHESIZE");
    expect(r.effects).toContainEqual({ kind: "synthesize", source: "kb" });
    expect(r.effects.some((e) => e.kind === "search" || e.kind === "fetch")).toBe(false);
  });

  it("should proceed with the web cycle when the KB verdict is null (conservative)", () => {
    const started = transition(
      { stage: "IDLE" } as ResearchState,
      {
        type: "start",
        question: "q",
        mode: "breadth",
        profile: profile(),
        jobId: "j",
        startedAt: T0,
      },
      T0,
    );
    const r = transition(
      started.state,
      {
        type: "queries_generated",
        queries: ["q1"],
        kbDocs: [
          { title: "A", path: "a.md" },
          { title: "B", path: "b.md" },
          { title: "C", path: "c.md" },
        ],
        kbSufficient: null,
        kbFreshRatio: 0.9,
      },
      T0,
    );
    expect(r.state.stage).toBe("SEARCH");
    expect(r.effects.map((e) => e.kind)).toEqual(["checkpoint", "search"]);
  });

  it("should short-circuit at ASSESS when the state is already KB-covered", () => {
    const state = { ...drive([]), kbCovered: true, stage: "ASSESS" as const };
    const r = transition(state, { type: "assessed", structural: PASS_STRUCTURAL }, T0);
    expect(r.state.stage).toBe("SYNTHESIZE");
    expect(r.effects).toContainEqual({ kind: "synthesize", source: "kb" });
  });
});

describe("transition — visited dedupe across cycles (T7)", () => {
  it("should only fetch never-visited canonical URLs in later cycles", () => {
    const state = drive([
      GEN,
      { type: "search_done", candidates: [cand("https://a.com/1"), cand("https://b.com/2")] },
      { type: "ranked", candidates: [cand("https://a.com/1"), cand("https://b.com/2")] },
      { type: "fetched", records: [rec("https://a.com/1", "x"), rec("https://b.com/2", "y")] },
      { type: "summarized", items: [item("https://a.com/1"), item("https://b.com/2")] },
      {
        type: "assessed",
        structural: { pass: false, gates: [], failed: ["SOURCES"], indeterminate: [] },
        judge: { sufficient: false, gaps: ["more sources needed"] },
      },
      { type: "refined", questions: ["q2"], coveredFacets: [] },
      {
        type: "queries_generated",
        queries: ["q2"],
        kbDocs: [],
        kbSufficient: null,
        kbFreshRatio: null,
      },
      {
        type: "search_done",
        candidates: [cand("https://a.com/1"), cand("https://b.com/2"), cand("https://c.com/3")],
      },
    ]);
    expect(state.stage).toBe("RANK");
    const { state: ranked, effects } = transition(
      state,
      {
        type: "ranked",
        candidates: [cand("https://a.com/1"), cand("https://b.com/2"), cand("https://c.com/3")],
      },
      T0,
    );
    expect(ranked.stage).toBe("FETCH");
    expect(effects[1]).toEqual({ kind: "fetch", urls: ["https://c.com/3"] });
  });
});
