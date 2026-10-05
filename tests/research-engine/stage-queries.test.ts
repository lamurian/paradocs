/**
 * Tests for QUERY_GEN/REFINE stage executors: kbFreshRatio math,
 * deterministic KB search, and the deterministic refine passthrough.
 *
 * After the subagent collapse QUERY_GEN performs only the KB search
 * (no LLM); REFINE is a deterministic cycle advance.
 *
 * @module tests/research-engine/stage-queries.test
 */

import { describe, it, expect, vi } from "vitest";

import { ASK_DEEP_PROFILE } from "../../extensions/research-engine/profiles.js";
import {
  kbFreshRatio,
  stageQueryGen,
  stageRefine,
} from "../../extensions/research-engine/stage-queries.js";

import type {
  ResearchDeps,
  KbDocWithTitle,
} from "../../extensions/research-engine/research-deps.js";
import type { ResearchState } from "../../extensions/research-engine/state.js";

const NOW = Date.parse("2026-10-02T00:00:00Z");

function state(overrides: Partial<ResearchState> = {}): ResearchState {
  return {
    jobId: "j",
    question: "what is x",
    mode: "breadth",
    profile: ASK_DEEP_PROFILE,
    stage: "QUERY_GEN",
    cycle: 1,
    startedAt: NOW,
    deadlineAt: NOW + 600_000,
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
    gaps: ["missing evaluation"],
    cycles: [],
    failures: [],
    llmErrorCount: 0,
    deadlineHit: false,
    degraded: false,
    trace: [],
    ...overrides,
  };
}

function depsWith(overrides: Partial<ResearchDeps> = {}): ResearchDeps {
  return {
    llm: vi.fn(() => Promise.resolve({ ok: false, error: "unused" })),
    searchSubagent: vi.fn(() => Promise.resolve({ ok: false, error: "unused" })),
    searchDocs: () => Promise.resolve([]),
    fetchUrl: () => Promise.resolve({ error: "unused" }),
    writeBack: () => Promise.resolve({ created: [], updated: [], skipped: [] }),
    knowledgeDir: "/kb",
    now: () => NOW,
    ...overrides,
  };
}

describe("kbFreshRatio", () => {
  it("should compute fresh/datable ratio with window math", () => {
    const docs = [
      { title: "A", path: "a", date: "2026-05-01" },
      { title: "B", path: "b", date: "2019-01-01" },
      { title: "C", path: "c" },
    ];
    expect(kbFreshRatio(docs, 365, NOW)).toBeCloseTo(0.5);
    expect(kbFreshRatio([], 365, NOW)).toBeNull();
    expect(kbFreshRatio(docs, null, NOW)).toBe(1);
    expect(kbFreshRatio([{ title: "X", path: "x" }], 365, NOW)).toBe(0);
  });
});

describe("stageQueryGen", () => {
  it("should tolerate KB search failures and emit deterministic queries", async () => {
    const deps = depsWith({ searchDocs: () => Promise.reject(new Error("db locked")) });
    const ev = await stageQueryGen(state(), deps, () => NOW);
    expect(ev.type).toBe("queries_generated");
    if (ev.type === "queries_generated") {
      expect(ev.queries).toEqual(["what is x"]);
      expect(ev.kbDocs).toEqual([]);
      expect(ev.kbSufficient).toBeNull();
      expect(ev.kbFreshRatio).toBeNull();
    }
  });

  it("should map KB doc gists and compute the freshness ratio (no LLM call)", async () => {
    const llm = vi.fn();
    const docs: KbDocWithTitle[] = [
      { title: "Fresh", path: "fresh.md", created: "2026-09-01T00:00:00.000Z" },
      { title: "Stale", path: "stale.md", created: "2019-01-01T00:00:00.000Z" },
    ];
    const deps = depsWith({ llm, searchDocs: () => Promise.resolve(docs) });
    const ev = await stageQueryGen(state(), deps, () => NOW);
    if (ev.type === "queries_generated") {
      expect(ev.kbDocs).toEqual([
        { title: "Fresh", path: "fresh.md", date: "2026-09-01T00:00:00.000Z" },
        { title: "Stale", path: "stale.md", date: "2019-01-01T00:00:00.000Z" },
      ]);
      expect(ev.kbFreshRatio).toBeCloseTo(0.5);
    }
    expect(llm).not.toHaveBeenCalled();
    expect(ev.type).toBe("queries_generated");
  });
});

describe("stageRefine", () => {
  it("should emit a deterministic refined event without LLM calls", async () => {
    const llm = vi.fn();
    const s = state({
      stage: "REFINE",
      cycle: 1,
      askedQuestions: ["q-old"],
      coveredFacets: ["tooling"],
      gaps: ["missing evaluation metrics"],
    });
    const ev = await stageRefine(s, depsWith({ llm }));
    expect(ev.type).toBe("refined");
    if (ev.type === "refined") {
      expect(ev.questions).toEqual(["what is x"]);
      expect(ev.coveredFacets).toEqual([]);
      expect(ev.llmErrors).toBe(0);
    }
    expect(llm).not.toHaveBeenCalled();
  });
});
