/**
 * Gap tests for transition-handlers.ts uncovered paths: the degraded
 * writeback_done branch (DONE_DEGRADED), the escalated handler and its
 * escalation effects, and the aborted handler in the HANDLERS table.
 * Pure FSM handlers — no I/O, no mocks.
 *
 * @module tests/research-engine/transition-handlers-gap
 */

import { describe, it, expect } from "vitest";

import { HANDLERS } from "../../extensions/research-engine/transition-handlers.js";

import type { ResearchEvent } from "../../extensions/research-engine/events.js";
import type { ResearchState } from "../../extensions/research-engine/state.js";

/** Minimal valid research state for handler entry. */
function prevState(overrides: Partial<ResearchState> = {}): ResearchState {
  return {
    jobId: "j",
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
    stage: "WRITE_BACK",
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

const WRITEBACK_EVENT = {
  type: "writeback_done",
  writeback: { created: ["Resources/a.md"], updated: [], skipped: [] },
} as ResearchEvent;

describe("HANDLERS.writeback_done", () => {
  it("commits DONE_SUFFICIENT when not degraded", () => {
    const t = HANDLERS.writeback_done(prevState(), WRITEBACK_EVENT, 5);
    expect(t.state.stage).toBe("DONE_SUFFICIENT");
    expect(t.state.writeback).toEqual({ created: ["Resources/a.md"], updated: [], skipped: [] });
    expect(t.effects).toEqual([{ kind: "checkpoint" }]);
  });

  it("commits DONE_DEGRADED when the previous state is degraded", () => {
    const t = HANDLERS.writeback_done(prevState({ degraded: true }), WRITEBACK_EVENT, 5);
    expect(t.state.stage).toBe("DONE_DEGRADED");
    expect(t.effects).toEqual([{ kind: "checkpoint" }]);
    expect(t.state.trace.at(-1)?.to).toBe("DONE_DEGRADED");
  });

  it("commits DONE_DEGRADED when synthesis errored", () => {
    const t = HANDLERS.writeback_done(
      prevState({ synthesisError: "synthesis down" }),
      WRITEBACK_EVENT,
      5,
    );
    expect(t.state.stage).toBe("DONE_DEGRADED");
  });
});

describe("HANDLERS.escalated", () => {
  it("commits ESCALATED with checkpoint, append_entry, and notify effects", () => {
    const decision = { reason: "budget exhausted" };
    const event = { type: "escalated", decision } as unknown as ResearchEvent;

    const t = HANDLERS.escalated(prevState({ stage: "ASSESS" }), event, 7);

    expect(t.state.stage).toBe("ESCALATED");
    expect(t.state.escalation).toEqual(decision);
    expect(t.effects.map((e) => e.kind)).toEqual(["checkpoint", "append_entry", "notify"]);
    const notify = t.effects.find((e) => e.kind === "notify");
    expect(notify).toMatchObject({ message: "research escalated: budget exhausted" });
    const append = t.effects.find((e) => e.kind === "append_entry");
    expect(append).toMatchObject({ customType: "research_escalation", data: decision });
  });
});

describe("HANDLERS.aborted", () => {
  it("commits CANCELLED with a checkpoint effect", () => {
    const event = { type: "aborted" } as ResearchEvent;
    const t = HANDLERS.aborted(prevState({ stage: "FETCH" }), event, 9);

    expect(t.state.stage).toBe("CANCELLED");
    expect(t.effects).toEqual([{ kind: "checkpoint" }]);
    expect(t.state.trace.at(-1)).toMatchObject({
      from: "FETCH",
      event: "aborted",
      to: "CANCELLED",
    });
  });
});
