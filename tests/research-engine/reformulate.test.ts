/**
 * Tests for deterministic reformulation logic (T15): breadth facet-fill,
 * depth covered-facet exclusion, invalid-JSON fallback.
 *
 * @module tests/research-engine/reformulate.test
 */

import { describe, it, expect } from "vitest";

import {
  refineResult,
  FACET_TEMPLATE,
  FACET_QUESTIONS,
} from "../../extensions/research-engine/reformulate.js";

const TOPIC = "AI agent guardrails";

describe("refineResult — breadth facet coverage (T15)", () => {
  it("should fill missing facets from the template with canonical questions", () => {
    const r = refineResult({
      phase: "breadth",
      topic: TOPIC,
      asked: [],
      coveredFacets: [],
      gaps: [],
      parsed: { questions: [`What mechanisms underlie ${TOPIC}?`], coveredFacets: [] },
    });
    expect(r.usedFallback).toBe(false);
    expect(r.questions).toHaveLength(FACET_TEMPLATE.length);
    for (const facet of FACET_TEMPLATE) {
      expect(r.questions.some((q) => q.toLowerCase().includes(facet.split("/")[0]))).toBe(true);
    }
    expect(r.questions).toContain(FACET_QUESTIONS.tooling(TOPIC));
    expect(r.coveredFacets).toEqual([...FACET_TEMPLATE]);
  });

  it("should keep LLM questions and append only genuinely missing facets", () => {
    const custom = "How do production teams evaluate guardrail effectiveness?";
    const r = refineResult({
      phase: "breadth",
      topic: TOPIC,
      asked: [],
      coveredFacets: [],
      gaps: [],
      parsed: { questions: [custom], coveredFacets: [] },
    });
    expect(r.questions).toContain(custom);
    expect(r.questions.length).toBeGreaterThan(1);
  });
});

describe("refineResult — depth exclusion (T15)", () => {
  it("should drop questions matching covered facets and already-asked questions", () => {
    const asked = "What tooling exists for guardrails?";
    const r = refineResult({
      phase: "depth",
      topic: TOPIC,
      asked: [asked],
      coveredFacets: ["tooling", "critiques/limits"],
      gaps: ["missing evaluation metrics"],
      parsed: {
        questions: [
          asked, // already asked → dropped
          "What frameworks implement guardrail policies?", // tooling keyword → dropped
          "What are the limitations of model-based guardrails?", // critiques keyword → dropped
          "What evaluation metrics exist for guardrail effectiveness?", // gap-targeted → kept
        ],
        coveredFacets: ["evidence"],
      },
    });
    expect(r.usedFallback).toBe(false);
    expect(r.questions).toEqual(["What evaluation metrics exist for guardrail effectiveness?"]);
    expect(r.coveredFacets).toContain("tooling");
    expect(r.coveredFacets).toContain("evidence");
  });
});

describe("refineResult — invalid-JSON fallback (T15)", () => {
  it("should fall back to existing questions plus one gap-derived question", () => {
    const r = refineResult({
      phase: "depth",
      topic: TOPIC,
      asked: ["q1"],
      coveredFacets: ["tooling"],
      gaps: ["missing field evidence"],
      parsed: null,
    });
    expect(r.usedFallback).toBe(true);
    expect(r.questions).toEqual(["q1", `${TOPIC}: missing field evidence`]);
  });

  it("should fall back to the topic when there are no prior questions or gaps", () => {
    const r = refineResult({
      phase: "breadth",
      topic: TOPIC,
      asked: [],
      coveredFacets: [],
      gaps: [],
      parsed: null,
    });
    expect(r.usedFallback).toBe(true);
    expect(r.questions).toEqual([TOPIC]);
  });
});
