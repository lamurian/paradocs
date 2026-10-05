/**
 * T8: Circuit breaker — 3 consecutive subagent failures within a stage
 * abort the run with the last real error message (success resets the
 * counter); the checkpoint still gets written via the degraded path.
 *
 * @module tests/research-engine/circuit-breaker.test
 */

import { mkdtempSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { afterAll, describe, it, expect, vi } from "vitest";

import { runResearch } from "../../extensions/research-engine/orchestrator.js";
import { ASK_QUICK_PROFILE } from "../../extensions/research-engine/profiles.js";
import {
  BREAKER_LIMIT,
  createBreaker,
  guardDepsWithBreaker,
  runStage,
} from "../../extensions/research-engine/stages.js";
import { transition } from "../../extensions/research-engine/transition.js";

import type {
  ResearchDeps,
  LlmCallInput,
  LlmCallOutcome,
  SearchSubagentOutcome,
} from "../../extensions/research-engine/research-deps.js";
import type { ResearchState } from "../../extensions/research-engine/state.js";

vi.mock("../../common/subagent.js", () => ({
  buildSubagentArgs: vi.fn(),
  getPiInvocation: vi.fn(),
  resolveSubagentTimeoutMs: vi.fn(() => 60_000),
  runSubagent: vi.fn(),
}));

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const NOW = Date.parse("2026-10-02T10:00:00Z");

function summarizeState(count: number): ResearchState {
  return {
    jobId: "job-break",
    question: "what is x",
    mode: "breadth",
    profile: ASK_QUICK_PROFILE,
    stage: "SUMMARIZE",
    cycle: 1,
    startedAt: NOW,
    deadlineAt: NOW + 900_000,
    queries: ["what is x"],
    kbDocs: [],
    kbSufficient: null,
    kbFreshRatio: null,
    kbCovered: false,
    candidates: [],
    lastRankCount: 0,
    fetches: Array.from({ length: count }, (_, i) => ({
      url: `https://a.com/${i + 1}`,
      canonicalUrl: `https://a.com/${i + 1}`,
      ok: true,
      content: `<title>Doc ${i + 1}</title><p>body</p>`,
      fetchedAt: NOW,
    })),
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
  };
}

function makeSearchSubagent(): ResearchDeps["searchSubagent"] {
  return vi.fn(
    (): Promise<SearchSubagentOutcome> => Promise.resolve({ ok: false, error: "unused" }),
  );
}

function baseDeps(llm: ResearchDeps["llm"], knowledgeDir: string): ResearchDeps {
  return {
    llm,
    searchSubagent: makeSearchSubagent(),
    searchDocs: () => Promise.resolve([]),
    fetchUrl: () => Promise.resolve({ error: "unused" }),
    writeBack: () => Promise.resolve({ created: [], updated: [], skipped: [] }),
    knowledgeDir,
    now: () => NOW,
  };
}

describe("createBreaker unit semantics", () => {
  it("trips after BREAKER_LIMIT consecutive failures; success resets", () => {
    const b = createBreaker();
    expect(BREAKER_LIMIT).toBe(3);
    expect(b.record(false, "e1")).toBe(false);
    expect(b.record(false, "e2")).toBe(false);
    expect(b.record(false, "e3")).toBe(true);
    expect(b.tripped).toBe(true);
    expect(b.error).toBe("e3");
  });

  it("does not trip when a success resets the counter", () => {
    const b = createBreaker();
    expect(b.record(false, "e1")).toBe(false);
    expect(b.record(false, "e2")).toBe(false);
    expect(b.record(true)).toBe(false);
    expect(b.record(false, "e4")).toBe(false);
    expect(b.record(false, "e5")).toBe(false);
    expect(b.tripped).toBe(false);
    expect(b.record(false, "e6")).toBe(true);
    expect(b.error).toBe("e6");
  });

  it("short-circuits guarded deps once tripped", async () => {
    const breaker = createBreaker();
    const llm = vi.fn(() => Promise.resolve({ ok: false, error: "x" }));
    const guarded = guardDepsWithBreaker(
      { llm, searchSubagent: makeSearchSubagent() } as unknown as ResearchDeps,
      breaker,
    );
    await guarded.llm({} as LlmCallInput);
    await guarded.llm({} as LlmCallInput);
    await guarded.llm({} as LlmCallInput);
    expect(breaker.tripped).toBe(true);
    const calls = llm.mock.calls.length;
    const res = await guarded.llm({} as LlmCallInput);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain("circuit breaker");
    expect(llm.mock.calls.length).toBe(calls); // no new spawn
  });
});

describe("runStage breaker integration", () => {
  it("failing 3 times in a row aborts to a degraded event carrying the third error", async () => {
    const knowledgeDir = mkdtempSync(join(homedir(), "breaker-3-"));
    dirs.push(knowledgeDir);
    const errors = ["err-one", "err-two", "err-three"];
    let i = 0;
    const llm = vi.fn((): Promise<LlmCallOutcome> => {
      const msg = errors[Math.min(i, errors.length - 1)];
      i++;
      return Promise.resolve({ ok: false, error: msg });
    });
    const deps = baseDeps(llm, knowledgeDir);

    const event = await runStage(summarizeState(3), deps, () => NOW);

    expect(event.type).toBe("synthesized");
    if (event.type === "synthesized") {
      expect(event.error).toBe("err-three");
      expect(event.synthesis).toBe("");
    }
    // The degraded path still transitions to WRITE_BACK with a checkpoint.
    const t = transition(summarizeState(3), event, NOW);
    expect(t.state.stage).toBe("WRITE_BACK");
    expect(t.effects).toContainEqual({ kind: "checkpoint" });
  });

  it("does not abort at the fifth call when a success reset the counter (aborts at the sixth)", async () => {
    const knowledgeDir = mkdtempSync(join(homedir(), "breaker-6-"));
    dirs.push(knowledgeDir);
    // Outcomes F,F,S,F,F,F. Completions are serialized so the breaker
    // observes them strictly in call order under fan-out.
    const outcomes: Array<{ ok: boolean; error?: string }> = [
      { ok: false, error: "f1" },
      { ok: false, error: "f2" },
      { ok: true },
      { ok: false, error: "f4" },
      { ok: false, error: "f5" },
      { ok: false, error: "f6" },
    ];
    let idx = 0;
    let prev: Promise<unknown> = Promise.resolve();
    const llm = vi.fn((): Promise<LlmCallOutcome> => {
      const run = prev.then(async () => {
        await new Promise((r) => setTimeout(r, 1));
        const o = outcomes[idx++];
        return o.ok ? { ok: true, value: "summary" } : { ok: false, error: o.error };
      });
      prev = run;
      return run;
    });
    const deps = baseDeps(llm, knowledgeDir);

    const event = await runStage(summarizeState(6), deps, () => NOW);

    // All six calls were dispatched — no abort at the fifth.
    expect(llm.mock.calls.length).toBe(6);
    // The trip happened at the sixth failure, carrying its message.
    expect(event.type).toBe("synthesized");
    if (event.type === "synthesized") expect(event.error).toBe("f6");
  });
});

describe("runResearch breaker path", () => {
  it("every subagent call failing degrades the run with the third error and writes a checkpoint", async () => {
    const knowledgeDir = mkdtempSync(join(homedir(), "breaker-e2e-"));
    dirs.push(knowledgeDir);
    const llm = vi.fn((input: LlmCallInput): Promise<LlmCallOutcome> => {
      const s = input.system;
      if (s.includes("name: summarizer")) return Promise.resolve({ ok: false, error: "boom-sum" });
      if (s.includes("name: judge")) return Promise.resolve({ ok: false, error: "boom-judge" });
      if (s.includes("name: synthesis")) return Promise.resolve({ ok: false, error: "boom-syn" });
      return Promise.resolve({ ok: false, error: "unused" });
    });
    const deps: ResearchDeps = {
      ...baseDeps(llm, knowledgeDir),
      searchSubagent: vi.fn(
        (): Promise<SearchSubagentOutcome> =>
          Promise.resolve({
            ok: true,
            value: {
              sources: ["https://a.com/1", "https://a.com/2", "https://a.com/3"].map((u) => ({
                url: u,
                snippet: "s",
                tier: 3,
              })),
              coveredFacets: [],
            },
          }),
      ),
      fetchUrl: (url: string) =>
        Promise.resolve({ content: `<title>Doc ${url}</title><p>body for ${url}</p>` }),
    };

    const state = await runResearch(deps, {
      question: "what is x",
      mode: "breadth",
      profile: ASK_QUICK_PROFILE,
      jobId: "job-break-e2e",
    });

    // Three summarize failures in a row trip the breaker → degraded terminal.
    expect(state.stage).toBe("DONE_DEGRADED");
    expect(state.synthesisError).toBe("boom-sum");
    // Checkpoint written for the job.
    const { loadCheckpoint, checkpointPathFor } =
      await import("../../extensions/research-engine/checkpoint.js");
    const loaded = loadCheckpoint(checkpointPathFor(knowledgeDir, "job-break-e2e"));
    expect(loaded).not.toBeNull();
  });
});
