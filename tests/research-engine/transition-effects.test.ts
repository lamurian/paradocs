/**
 * Tests for long-doc summarize effects (T9) and checkpoint resume (T16).
 *
 * @module tests/research-engine/transition-effects.test
 */

import { mkdtempSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { afterAll, describe, it, expect } from "vitest";

import {
  checkpointPathFor,
  loadCheckpoint,
  saveCheckpoint,
} from "../../extensions/research-engine/checkpoint.js";
import { ASK_DEEP_PROFILE } from "../../extensions/research-engine/profiles.js";
import {
  transition,
  stageEffects,
  TERMINAL_STAGES,
} from "../../extensions/research-engine/transition.js";

import type {
  Candidate,
  FetchRecord,
  ResearchState,
  StructuralResult,
} from "../../extensions/research-engine/state.js";
import type { ResearchEvent } from "../../extensions/research-engine/transition.js";

const T0 = Date.parse("2026-10-02T10:00:00Z");
const tmpDirs: string[] = [];

afterAll(() => {
  for (const d of tmpDirs) rmSync(d, { recursive: true, force: true });
});

function tmp(): string {
  const d = mkdtempSync(join(homedir(), "research-effects-test-"));
  tmpDirs.push(d);
  return d;
}

function cand(url: string): Candidate {
  return { url, canonicalUrl: url, tier: 3, query: "q1" };
}

function rec(url: string, content: string): FetchRecord {
  return { url, canonicalUrl: url, ok: true, content, fetchedAt: T0 };
}

const GEN: ResearchEvent = {
  type: "queries_generated",
  queries: ["q1"],
  kbDocs: [],
  kbSufficient: null,
  kbFreshRatio: null,
};
const PASS_STRUCTURAL: StructuralResult = { pass: true, gates: [], failed: [], indeterminate: [] };

function drive(events: ResearchEvent[]): ResearchState {
  let { state } = transition(
    { stage: "IDLE" } as ResearchState,
    {
      type: "start",
      question: "q",
      mode: "breadth",
      profile: ASK_DEEP_PROFILE,
      jobId: "job-1",
      startedAt: T0,
    },
    T0,
  );
  for (const e of events) state = transition(state, e, T0).state;
  return state;
}

describe("transition — long-doc summarize effects (T9)", () => {
  function fetchedWith(content: string) {
    const state = drive([
      GEN,
      { type: "search_done", candidates: [cand("https://a.com/1")] },
      { type: "ranked", candidates: [cand("https://a.com/1")] },
    ]);
    return transition(state, { type: "fetched", records: [rec("https://a.com/1", content)] }, T0);
  }

  it("should emit one whole-doc summarizer effect for small docs", () => {
    const { effects } = fetchedWith("x".repeat(10_000));
    expect(effects.map((e) => e.kind)).toEqual(["checkpoint", "summarize"]);
    expect(effects[1]).toMatchObject({ mode: "whole" });
  });

  it("should emit chunk + merge effects for mid-size docs", () => {
    const { effects } = fetchedWith("x".repeat(60_000));
    expect(effects.map((e) => e.kind)).toEqual([
      "checkpoint",
      "summarize_chunk",
      "summarize_chunk",
      "summarize_merge",
    ]);
  });

  it("should emit head+tail with truncation flag for very long docs", () => {
    const { effects } = fetchedWith("x".repeat(250_000));
    expect(effects[1]).toMatchObject({
      kind: "summarize",
      mode: "head_tail",
      truncation: "head_tail",
    });
    expect((effects[1] as { text: string }).text.length).toBeLessThanOrEqual(35_050);
  });
});

describe("transition & checkpoints — resume semantics (T16)", () => {
  it("should include a checkpoint effect on every non-no-op transition", () => {
    const started = transition(
      { stage: "IDLE" } as ResearchState,
      {
        type: "start",
        question: "q",
        mode: "breadth",
        profile: ASK_DEEP_PROFILE,
        jobId: "j",
        startedAt: T0,
      },
      T0,
    );
    expect(started.effects[0]).toEqual({ kind: "checkpoint" });
    const next = transition(started.state, GEN, T0);
    expect(next.effects[0]).toEqual({ kind: "checkpoint" });
  });

  it("should restore an identical state from a checkpoint file", () => {
    const dir = tmp();
    const state = drive([GEN]);
    const path = saveCheckpoint(dir, state);
    const loaded = loadCheckpoint(path);
    expect(loaded).not.toBeNull();
    expect(loaded!.state).toEqual(state);
    expect(loaded!.lastTransition).toEqual(state.trace[state.trace.length - 1]);
  });

  it("should resume with effects only for the current stage (no replay)", () => {
    const dir = tmp();
    const state = drive([
      GEN,
      { type: "search_done", candidates: [cand("https://a.com/1")] },
      { type: "ranked", candidates: [cand("https://a.com/1")] },
      { type: "fetched", records: [rec("https://a.com/1", "x".repeat(1000))] },
    ]);
    saveCheckpoint(dir, state);
    const loaded = loadCheckpoint(checkpointPathFor(dir, "job-1"));
    expect(loaded).not.toBeNull();
    expect(loaded!.state.stage).toBe("SUMMARIZE");
    const effects = stageEffects(loaded!.state.stage, loaded!.state);
    expect(effects.length).toBeGreaterThan(0);
    expect(effects.every((e) => e.kind.startsWith("summarize"))).toBe(true);
  });

  it("should produce no effects for terminal stages on resume", () => {
    const dir = tmp();
    const state = drive([
      GEN,
      { type: "search_done", candidates: [] },
      { type: "ranked", candidates: [] },
      { type: "fetched", records: [] },
      { type: "summarized", items: [] },
      { type: "assessed", structural: PASS_STRUCTURAL },
      { type: "synthesized", synthesis: "a" },
      { type: "writeback_done", writeback: { created: [], updated: [], skipped: [] } },
    ]);
    saveCheckpoint(dir, state);
    const loaded = loadCheckpoint(checkpointPathFor(dir, "job-1"))!;
    expect(stageEffects(loaded.state.stage, loaded.state)).toEqual([]);
  });

  it("FETCH plans only unvisited candidate URLs; WRITE_BACK plans writeback; IDLE plans nothing", () => {
    const base = drive([GEN]);
    const fetchState = {
      ...base,
      stage: "FETCH" as const,
      candidates: [cand("https://a.com/1"), cand("https://b.com/2")],
      visited: ["https://a.com/1"],
    };
    expect(stageEffects("FETCH", fetchState)).toEqual([
      { kind: "fetch", urls: ["https://b.com/2"] },
    ]);
    expect(stageEffects("WRITE_BACK", base)).toEqual([{ kind: "writeback" }]);
    expect(stageEffects("IDLE", base)).toEqual([]);
    expect(stageEffects("DONE_SUFFICIENT", base)).toEqual([]);
  });

  it("terminal states swallow all further events with zero effects", () => {
    const done = drive([
      GEN,
      { type: "search_done", candidates: [] },
      { type: "ranked", candidates: [] },
      { type: "fetched", records: [] },
      { type: "summarized", items: [] },
      { type: "assessed", structural: PASS_STRUCTURAL },
      { type: "synthesized", synthesis: "answer" },
      { type: "writeback_done", writeback: { created: [], updated: [], skipped: [] } },
    ]);
    expect(done.stage).toBe("DONE_SUFFICIENT");
    for (const terminal of TERMINAL_STAGES) {
      const t = { ...done, stage: terminal };
      const r = transition(t, { type: "search_done", candidates: [] }, T0);
      expect(r.state).toBe(t);
      expect(r.effects).toEqual([]);
    }
  });
});
