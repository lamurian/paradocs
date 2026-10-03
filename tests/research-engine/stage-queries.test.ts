/**
 * Tests for QUERY_GEN/REFINE stage executors: kbFreshRatio math,
 * KB-search failure tolerance, LLM fallbacks.
 *
 * @module tests/research-engine/stage-queries.test
 */

import { describe, it, expect, vi } from "vitest";

import {
  ASK_DEEP_PROFILE,
  ASK_QUICK_PROFILE,
  RESEARCH_PROFILE,
} from "../../extensions/research-engine/profiles.js";
import {
  kbFreshRatio,
  stageQueryGen,
  stageRefine,
} from "../../extensions/research-engine/stage-queries.js";

import type {
  LlmCallInput,
  LlmCallOutcome,
  ResearchDeps,
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

function depsWith(llm: ResearchDeps["llm"], overrides: Partial<ResearchDeps> = {}): ResearchDeps {
  return {
    llm,
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
  it("should tolerate KB search failures and fall back on invalid LLM output", async () => {
    const llm = vi.fn(
      (): Promise<LlmCallOutcome> => Promise.resolve({ ok: true, value: { noqueries: true } }),
    );
    const deps = depsWith(llm, {
      searchDocs: () => Promise.reject(new Error("db locked")),
    });
    const ev = await stageQueryGen(state(), deps, () => NOW);
    expect(ev.type).toBe("queries_generated");
    if (ev.type === "queries_generated") {
      expect(ev.queries).toEqual(["what is x"]);
      expect(ev.kbDocs).toEqual([]);
      expect(ev.kbSufficient).toBeNull();
      expect(ev.llmErrors).toBe(1);
    }
  });

  it("should expand breadth queries to the facet template for /research only", async () => {
    const llm = vi.fn((input: LlmCallInput): Promise<LlmCallOutcome> => {
      expect(input.label).toBe("Querying…");
      return Promise.resolve({
        ok: true,
        value: { queries: ["mechanisms of x"], kbSufficient: false },
      });
    });
    const research = await stageQueryGen(
      state({ profile: RESEARCH_PROFILE }),
      depsWith(llm),
      () => NOW,
    );
    if (research.type === "queries_generated") {
      expect(research.queries.length).toBeGreaterThanOrEqual(5);
      expect(research.queries).toContain("What tooling and frameworks exist for what is x?");
    }
    const quick = await stageQueryGen(
      state({ profile: ASK_QUICK_PROFILE }),
      depsWith(llm),
      () => NOW,
    );
    if (quick.type === "queries_generated") {
      expect(quick.queries).toEqual(["mechanisms of x"]);
    }
  });
});

describe("stageRefine", () => {
  it("should fall back deterministically to asked + gap-derived questions on LLM failure", async () => {
    const llm = vi.fn((): Promise<LlmCallOutcome> => Promise.resolve({ ok: false, error: "429" }));
    const s = state({
      stage: "REFINE",
      cycle: 1,
      askedQuestions: ["q-old"],
      coveredFacets: ["tooling"],
      gaps: ["missing evaluation metrics"],
    });
    const ev = await stageRefine(s, depsWith(llm));
    expect(ev.type).toBe("refined");
    if (ev.type === "refined") {
      expect(ev.llmErrors).toBe(1);
      expect(ev.questions).toEqual(["q-old", "what is x: missing evaluation metrics"]);
    }
  });

  it("should keep validated depth questions and drop asked/covered matches", async () => {
    const llm = vi.fn((input: LlmCallInput): Promise<LlmCallOutcome> => {
      expect(input.label).toBe("Refining…");
      return Promise.resolve({
        ok: true,
        value: {
          questions: ["q-old", "What tooling exists?", "Fresh evaluation question?"],
          coveredFacets: ["evidence"],
        },
      });
    });
    const s = state({
      stage: "REFINE",
      cycle: 2,
      askedQuestions: ["q-old"],
      coveredFacets: ["tooling"],
      gaps: [],
    });
    const ev = await stageRefine(s, depsWith(llm));
    if (ev.type === "refined") {
      expect(ev.llmErrors).toBe(0);
      expect(ev.questions).toEqual(["Fresh evaluation question?"]);
      expect(ev.coveredFacets).toEqual(["tooling", "evidence"]);
    }
  });
});
