/**
 * Tests for research-engine effects: long-doc planner (T9), LLM boundary
 * parsers (T15 supporting), prompt loading.
 *
 * @module tests/research-engine/effects.test
 */

import { describe, it, expect } from "vitest";

import {
  planSummarization,
  buildSummarizeEffects,
  parseQueries,
  parseRanked,
  parseSummaryText,
  parseJudge,
  parseRefine,
  parseSynthesis,
  prompt,
  WHOLE_DOC_MAX,
} from "../../extensions/research-engine/effects.js";

import type { FetchRecord } from "../../extensions/research-engine/state.js";

function rec(content: string, url = "https://a.com/1"): FetchRecord {
  return { url, canonicalUrl: url, ok: true, content, fetchedAt: 0 };
}

describe("planSummarization (T9)", () => {
  it("should plan whole-doc for content up to the cap", () => {
    expect(planSummarization("x".repeat(WHOLE_DOC_MAX)).mode).toBe("whole");
    const plan = planSummarization("hello world");
    expect(plan).toEqual({ mode: "whole", text: "hello world" });
  });

  it("should plan ceil(len/35K) chunks for mid-size docs", () => {
    const plan = planSummarization("x".repeat(60_000));
    expect(plan.mode).toBe("chunks");
    if (plan.mode === "chunks") expect(plan.chunks).toHaveLength(2);
    const plan2 = planSummarization("x".repeat(100_000));
    if (plan2.mode === "chunks") expect(plan2.chunks).toHaveLength(3);
  });

  it("should plan head+tail within the budget above 200K, flagged", () => {
    const plan = planSummarization("x".repeat(250_000));
    expect(plan.mode).toBe("head_tail");
    if (plan.mode === "head_tail") {
      expect(plan.truncation).toBe("head_tail");
      expect(plan.text.length).toBeLessThanOrEqual(WHOLE_DOC_MAX + 60);
      expect(plan.text).toContain("[... middle of document omitted ...]");
    }
  });

  it("should strip boilerplate before planning", () => {
    const plan = planSummarization("![img](x)\nSign in\n\n\nReal content here");
    expect(plan.mode).toBe("whole");
    if (plan.mode === "whole") {
      expect(plan.text).not.toContain("![");
      expect(plan.text).toContain("Real content here");
    }
  });
});

describe("buildSummarizeEffects", () => {
  it("should skip failed records and plan per-record effects", () => {
    const effects = buildSummarizeEffects([
      rec("x".repeat(1000)),
      {
        url: "https://bad.com",
        canonicalUrl: "https://bad.com",
        ok: false,
        error: "e",
        fetchedAt: 0,
      },
      rec("y".repeat(60_000), "https://b.com/2"),
    ]);
    const kinds = effects.map((e) => e.kind);
    expect(kinds).toEqual(["summarize", "summarize_chunk", "summarize_chunk", "summarize_merge"]);
  });
});

describe("LLM boundary parsers (T15 supporting)", () => {
  it("parseQueries should validate queries + kb_sufficient", () => {
    expect(parseQueries('{"queries": ["a", "b"], "kb_sufficient": true}')).toEqual({
      queries: ["a", "b"],
      kbSufficient: true,
    });
    expect(parseQueries('```json\n{"queries": ["only"]}\n```')).toEqual({
      queries: ["only"],
      kbSufficient: null,
    });
    expect(parseQueries("not json")).toBeNull();
    expect(parseQueries('{"queries": []}')).toBeNull();
  });

  it("parseRanked should filter to allowed canonical URLs preserving order", () => {
    const allowed = new Set(["https://a.com/1", "https://b.com/2"]);
    const out = parseRanked(
      '["https://b.com/2", "https://evil.com/x", "https://a.com/1", "https://b.com/2"]',
      allowed,
    );
    expect(out).toEqual(["https://b.com/2", "https://a.com/1"]);
    expect(parseRanked('["https://evil.com/x"]', allowed)).toBeNull();
  });

  it("parseSummaryText should strip fences and reject empties", () => {
    expect(parseSummaryText("```markdown\nA solid summary.\n```")).toBe("A solid summary.");
    expect(parseSummaryText("   ")).toBeNull();
  });

  it("parseJudge should require a boolean sufficient field", () => {
    expect(parseJudge('{"sufficient": false, "gaps": ["g1"]}')).toEqual({
      sufficient: false,
      gaps: ["g1"],
    });
    expect(parseJudge('{"gaps": ["g1"]}')).toBeNull();
    expect(parseJudge("nope")).toBeNull();
  });

  it("parseRefine should validate questions and map covered_facets", () => {
    expect(parseRefine('{"questions": ["q1"], "covered_facets": ["tooling"]}')).toEqual({
      questions: ["q1"],
      coveredFacets: ["tooling"],
    });
    expect(parseRefine('{"covered_facets": ["tooling"]}')).toBeNull();
  });

  it("parseSynthesis should reject empty output", () => {
    expect(parseSynthesis("  The answer.  ")).toBe("The answer.");
    expect(parseSynthesis("")).toBeNull();
  });
});

describe("prompt loading", () => {
  it("should load all five pipeline prompts from prompts/*.md", () => {
    for (const name of ["query-gen", "rank", "summarizer", "judge", "reformulate"]) {
      expect(prompt(name).length).toBeGreaterThan(50);
    }
    expect(prompt("missing-prompt")).toBe("");
  });
});
