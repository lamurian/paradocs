/**
 * Tests for research-engine state: checkpoint paths, save/load roundtrip,
 * digest building.
 *
 * @module tests/research-engine/state.test
 */

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { afterAll, describe, it, expect } from "vitest";

import {
  researchStateDir,
  checkpointPathFor,
  saveCheckpoint,
  loadCheckpoint,
  RESEARCH_STATE_SUBDIR,
} from "../../extensions/research-engine/checkpoint.js";
import { ASK_QUICK_PROFILE } from "../../extensions/research-engine/profiles.js";
import { buildDigest } from "../../extensions/research-engine/state.js";

import type { ResearchState } from "../../extensions/research-engine/state.js";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function baseState(overrides: Partial<ResearchState> = {}): ResearchState {
  return {
    jobId: "job-42",
    question: "what is X",
    mode: "quick" as never,
    profile: ASK_QUICK_PROFILE,
    stage: "SUMMARIZE",
    cycle: 1,
    startedAt: 1000,
    deadlineAt: 91_000,
    queries: ["q1"],
    kbDocs: [{ title: "A", path: "a.md" }],
    kbSufficient: null,
    kbFreshRatio: null,
    kbCovered: false,
    candidates: [],
    lastRankCount: 3,
    fetches: [],
    summaries: [{ url: "https://a.com/1", canonicalUrl: "https://a.com/1", summary: "s" }],
    visited: ["https://a.com/1"],
    askedQuestions: ["q1"],
    coveredFacets: [],
    gaps: ["g1"],
    cycles: [{ cycle: 1, questions: ["q1"], candidates: 3, fetched: 1, summarized: 1 }],
    failures: [{ stage: "FETCH", error: "timed out", url: "https://b.com" }],
    llmErrorCount: 0,
    deadlineHit: false,
    degraded: false,
    trace: [
      { ts: 1000, from: "IDLE", event: "start", to: "QUERY_GEN" },
      { ts: 2000, from: "QUERY_GEN", event: "queries_generated", to: "SEARCH" },
    ],
    ...overrides,
  };
}

describe("state — checkpoint paths", () => {
  it("should resolve the .research subdir and per-job file", () => {
    expect(researchStateDir("/kb")).toBe(join("/kb", RESEARCH_STATE_SUBDIR));
    expect(checkpointPathFor("/kb", "job-42")).toBe(
      join("/kb", RESEARCH_STATE_SUBDIR, "job-42.json"),
    );
  });
});

describe("state — save/load roundtrip (T16)", () => {
  it("should persist {state, lastTransition} and restore identically", () => {
    const dir = mkdtempSync(join(homedir(), "research-state-test-"));
    dirs.push(dir);
    const state = baseState();
    const path = saveCheckpoint(dir, state);
    expect(path).toContain("job-42.json");

    const loaded = loadCheckpoint(path);
    expect(loaded).not.toBeNull();
    expect(loaded!.state).toEqual(state);
    expect(loaded!.lastTransition).toEqual({
      ts: 2000,
      from: "QUERY_GEN",
      event: "queries_generated",
      to: "SEARCH",
    });
  });

  it("should return null for missing or corrupt checkpoints", () => {
    const dir = mkdtempSync(join(homedir(), "research-state-test-"));
    dirs.push(dir);
    expect(loadCheckpoint(join(dir, "nope.json"))).toBeNull();
    const corrupt = join(dir, "corrupt.json");
    writeFileSync(corrupt, "{not valid json", "utf-8");
    expect(loadCheckpoint(corrupt)).toBeNull();
    writeFileSync(corrupt, JSON.stringify({ noState: true }), "utf-8");
    expect(loadCheckpoint(corrupt)).toBeNull();
  });
});

describe("state — digest (T14 supporting)", () => {
  it("should expose questions per cycle, source count, gaps, failures, terminal stage", () => {
    const d = buildDigest(baseState({ stage: "DONE_DEGRADED" }));
    expect(d.jobId).toBe("job-42");
    expect(d.sourceCount).toBe(1);
    expect(d.questionsByCycle).toEqual([["q1"]]);
    expect(d.gaps).toEqual(["g1"]);
    expect(d.failures[0].error).toBe("timed out");
    expect(d.terminalStage).toBe("DONE_DEGRADED");
  });
});
