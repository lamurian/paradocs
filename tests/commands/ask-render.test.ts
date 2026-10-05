/**
 * T7: Answer renderers apply the deterministic synthesis fallback chain
 * (synthesis → joined summaries → KB docs + source titles/URLs) and
 * emit no emojis.
 *
 * @module tests/research-engine/ask-render.test
 */

import { describe, it, expect, vi } from "vitest";

import { renderAskAnswer } from "../../extensions/commands/ask.js";

// Heavy transitive modules are mocked so their real code never loads in
// this worker (partial top-level loads corrupt v8 coverage attribution
// in full-suite runs). Renderer tests need none of their behavior.
vi.mock("../../extensions/research-engine/deps.js", () => ({
  buildResearchDeps: vi.fn(() => ({})),
}));
vi.mock("../../extensions/research-engine/orchestrator.js", async () => {
  const { DEFAULT_STAGE_MESSAGES } =
    await import("../../extensions/research-engine/research-deps.js");
  return { runResearch: vi.fn(), DEFAULT_STAGE_MESSAGES };
});
vi.mock("../../extensions/research-engine/writeback.js", () => ({
  writeBackToKB: vi.fn(),
  parseGrouping: vi.fn(),
}));

import type { ResearchState } from "../../extensions/research-engine/state.js";

const EMOJI = /\p{Extended_Pictographic}/u;

function baseState(overrides: Partial<ResearchState> = {}): ResearchState {
  return {
    jobId: "j",
    question: "what is x",
    mode: "breadth",
    profile: {
      name: "ask-quick",
      targetSources: 5,
      maxCycles: 1,
      deadlineMs: 90_000,
      minDomains: 2,
      requireAuthoritative: false,
      freshnessWindowDays: null,
    },
    stage: "DONE_DEGRADED",
    cycle: 1,
    startedAt: 0,
    deadlineAt: 1,
    queries: ["what is x"],
    kbDocs: [],
    kbSufficient: null,
    kbFreshRatio: null,
    kbCovered: false,
    candidates: [],
    lastRankCount: 0,
    fetches: [],
    summaries: [],
    visited: [],
    askedQuestions: ["what is x"],
    coveredFacets: [],
    gaps: [],
    cycles: [],
    failures: [],
    llmErrorCount: 0,
    deadlineHit: false,
    degraded: true,
    trace: [],
    ...overrides,
  };
}

describe("renderAskAnswer (T7)", () => {
  it("returns synthesis text verbatim", () => {
    const state = baseState({ synthesis: "The final answer." });
    const out = renderAskAnswer("what is x", state);
    expect(out).toContain("The final answer.");
    expect(out).not.toContain("synthesis unavailable");
  });

  it("with empty synthesis and summaries present, joins summaries plus the unavailable note", () => {
    const state = baseState({
      synthesis: undefined,
      synthesisError: "synthesis endpoint down",
      summaries: [
        {
          url: "https://a.com/1",
          canonicalUrl: "https://a.com/1",
          summary: "Finding one.",
          title: "Doc One",
        },
        {
          url: "https://b.com/2",
          canonicalUrl: "https://b.com/2",
          summary: "Finding two.",
        },
      ],
    });
    const out = renderAskAnswer("what is x", state);
    expect(out).toContain("Finding one.");
    expect(out).toContain("Finding two.");
    expect(out).toContain("_(synthesis unavailable: synthesis endpoint down)_");
  });

  it("with neither synthesis nor summaries, lists KB docs and source titles/URLs", () => {
    const state = baseState({
      synthesis: undefined,
      synthesisError: undefined,
      kbDocs: [{ title: "Harness Overview", path: "Resources/harness-overview.md" }],
      fetches: [
        {
          url: "https://a.com/1",
          canonicalUrl: "https://a.com/1",
          ok: true,
          title: "Loop Anatomy",
          fetchedAt: 0,
        },
      ],
    });
    const out = renderAskAnswer("what is x", state);
    expect(out).toContain("Harness Overview");
    expect(out).toContain("Resources/harness-overview.md");
    expect(out).toContain("Loop Anatomy");
    expect(out).toContain("https://a.com/1");
    expect(out).toContain("_(synthesis unavailable: no sources collected)_");
  });

  it("includes write-back status lines and the draft line", () => {
    const state = baseState({
      synthesis: "Answer.",
      writeback: {
        created: ["Resources/n.md"],
        updated: [],
        skipped: ["draft: /kb/.research/drafts/j.md"],
      },
    });
    const out = renderAskAnswer("what is x", state);
    expect(out).toContain("created: Resources/n.md");
    expect(out).toContain("draft: /kb/.research/drafts/j.md");
  });

  it("emits no emojis in renderAskAnswer output", () => {
    const state = baseState({
      synthesis: undefined,
      writeback: { created: [], updated: [], skipped: ["draft: /kb/.research/drafts/j.md"] },
    });
    const out = renderAskAnswer("what is x", state);
    expect(out.match(EMOJI)).toBeNull();
  });

  it("research_engine renderResult emits no emojis and applies the fallback chain", async () => {
    const { renderResult } = await import("../../extensions/research-engine/index.js");
    const state = baseState({
      synthesis: undefined,
      summaries: [
        {
          url: "https://a.com/1",
          canonicalUrl: "https://a.com/1",
          summary: "Grounded finding.",
        },
      ],
    });
    const out = renderResult(state);
    expect(out).toContain("Grounded finding.");
    expect(out).toContain("_(synthesis unavailable");
    expect(out.match(EMOJI)).toBeNull();
  });
});
