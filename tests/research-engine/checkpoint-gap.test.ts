/**
 * Gap tests for checkpoint.ts uncovered branches: saveCheckpoint with a
 * non-empty trace (lastTransition persisted) and with an empty trace
 * (lastTransition null), plus the loadCheckpoint round-trip. Real fs
 * into a temp KNOWLEDGE_DIR — no mocks.
 *
 * @module tests/research-engine/checkpoint-gap
 */

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, it, expect, beforeEach, afterEach } from "vitest";

import {
  checkpointPathFor,
  loadCheckpoint,
  researchStateDir,
  saveCheckpoint,
} from "../../extensions/research-engine/checkpoint.js";

import type { ResearchState, TransitionRecord } from "../../extensions/research-engine/state.js";

let knowledgeDir: string;

/** Minimal valid research state for checkpoint persistence. */
function state(overrides: Partial<ResearchState> = {}): ResearchState {
  return {
    jobId: "job-cp",
    question: "q",
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
    stage: "SYNTHESIZE",
    cycle: 2,
    startedAt: 0,
    deadlineAt: 1,
    queries: [],
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

describe("saveCheckpoint / loadCheckpoint", () => {
  beforeEach(() => {
    knowledgeDir = mkdtempSync(join(tmpdir(), "checkpoint-gap-"));
  });

  afterEach(() => {
    rmSync(knowledgeDir, { recursive: true, force: true });
  });

  it("persists the last transition when the trace is non-empty", () => {
    const record: TransitionRecord = {
      ts: 42,
      from: "FETCH",
      event: "summarized",
      to: "SYNTHESIZE",
    };
    const st = state({ trace: [record] });

    const path = saveCheckpoint(knowledgeDir, st);

    expect(path).toBe(checkpointPathFor(knowledgeDir, "job-cp"));
    expect(path).toBe(join(researchStateDir(knowledgeDir), "job-cp.json"));
    const raw = JSON.parse(readFileSync(path, "utf-8")) as {
      state: ResearchState;
      lastTransition: TransitionRecord | null;
    };
    expect(raw.state.jobId).toBe("job-cp");
    expect(raw.state.stage).toBe("SYNTHESIZE");
    expect(raw.lastTransition).toEqual(record);
  });

  it("persists a null last transition when the trace is empty", () => {
    const path = saveCheckpoint(knowledgeDir, state());

    const raw = JSON.parse(readFileSync(path, "utf-8")) as { lastTransition: null };
    expect(raw.lastTransition).toBeNull();
  });

  it("round-trips through loadCheckpoint", () => {
    const st = state({ trace: [{ ts: 1, from: "SEARCH", event: "fetched", to: "FETCH" }] });
    const path = saveCheckpoint(knowledgeDir, st);

    const loaded = loadCheckpoint(path);

    expect(loaded).not.toBeNull();
    expect(loaded?.state.jobId).toBe("job-cp");
    expect(loaded?.state.trace).toEqual(st.trace);
  });

  it("returns null when the checkpoint file is missing", () => {
    expect(loadCheckpoint(join(knowledgeDir, "nope.json"))).toBeNull();
  });
});
