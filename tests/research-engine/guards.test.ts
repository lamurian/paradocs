/**
 * Table-driven tests for research-engine guards: structural gates (T2),
 * judge combination (T3), escalation truth table (T4), kbCovered (T5).
 *
 * @module tests/research-engine/guards.test
 */

import { describe, it, expect } from "vitest";

import {
  evaluateGates,
  evaluateKbCovered,
  combineJudgment,
  synthesizeGaps,
  evaluateEscalation,
} from "../../extensions/research-engine/guards.js";

import type { GateProfile } from "../../extensions/research-engine/state.js";

const NOW = Date.parse("2026-10-02T00:00:00Z");

function profile(overrides: Partial<GateProfile> = {}): GateProfile {
  return {
    name: "test",
    targetSources: 15,
    maxCycles: 3,
    deadlineMs: 600_000,
    minDomains: 4,
    requireAuthoritative: true,
    freshnessWindowDays: 365,
    ...overrides,
  };
}

function summaries(n: number, domains: string[]): Array<{ canonicalUrl: string; url: string }> {
  return Array.from({ length: n }, (_, i) => {
    const host = domains[i % domains.length];
    return { canonicalUrl: `https://${host}/p${i}`, url: `https://${host}/p${i}` };
  });
}

describe("evaluateGates (T2)", () => {
  it("should pass all gates for sufficient, diverse, fresh sources", () => {
    const sum = summaries(15, ["a.com", "b.com", "c.com", "d.com", "e.com"]);
    const tier = new Map(sum.map((s) => [s.canonicalUrl, { tier: 1, year: 2026 }]));
    const r = evaluateGates(sum, tier, profile(), NOW);
    expect(r.pass).toBe(true);
    expect(r.failed).toEqual([]);
    expect(r.indeterminate).toEqual([]);
  });

  it("should fail SOURCES below target", () => {
    const sum = summaries(5, ["a.com", "b.com", "c.com", "d.com", "e.com"]);
    const tier = new Map(sum.map((s) => [s.canonicalUrl, { tier: 1, year: 2026 }]));
    const r = evaluateGates(sum, tier, profile(), NOW);
    expect(r.failed).toContain("SOURCES");
    expect(r.pass).toBe(false);
  });

  it("should fail DOMAINS below minDomains", () => {
    const sum = summaries(15, ["a.com", "b.com"]);
    const tier = new Map(sum.map((s) => [s.canonicalUrl, { tier: 1, year: 2026 }]));
    const r = evaluateGates(sum, tier, profile(), NOW);
    expect(r.failed).toContain("DOMAINS");
    expect(r.gates.find((g) => g.code === "DOMAINS")?.detail).toContain("only 2 domains");
  });

  it("should fail AUTHORITY when no tier-1/2 or academic source exists", () => {
    const sum = summaries(15, ["a.com", "b.com", "c.com", "d.com", "e.com"]);
    const tier = new Map(sum.map((s) => [s.canonicalUrl, { tier: 3, year: 2026 }]));
    const r = evaluateGates(sum, tier, profile(), NOW);
    expect(r.failed).toContain("AUTHORITY");
  });

  it("should pass AUTHORITY via domain heuristic even with tier 3", () => {
    const sum = summaries(15, ["cs.stanford.edu", "b.com", "c.com", "d.com", "e.com"]);
    const tier = new Map(sum.map((s) => [s.canonicalUrl, { tier: 3, year: 2026 }]));
    const r = evaluateGates(sum, tier, profile(), NOW);
    expect(r.failed).not.toContain("AUTHORITY");
  });

  it("should fail FRESHNESS when under 70% of datable sources are in window", () => {
    const sum = summaries(15, ["a.com", "b.com", "c.com", "d.com", "e.com"]);
    const tier = new Map(sum.map((s) => [s.canonicalUrl, { tier: 1, year: 2019 }]));
    const r = evaluateGates(sum, tier, profile(), NOW);
    expect(r.failed).toContain("FRESHNESS");
  });

  it("should return FRESHNESS indeterminate when under half the sources are datable", () => {
    const sum = summaries(15, ["a.com", "b.com", "c.com", "d.com", "e.com"]);
    const tier = new Map(
      sum.map((s, i) => [s.canonicalUrl, { tier: 1, year: i < 5 ? 2026 : undefined }]),
    );
    const r = evaluateGates(sum, tier, profile(), NOW);
    expect(r.indeterminate).toContain("FRESHNESS");
    expect(r.failed).not.toContain("FRESHNESS");
  });

  it("should ignore FRESHNESS when the window is null", () => {
    const sum = summaries(15, ["a.com", "b.com", "c.com", "d.com", "e.com"]);
    const tier = new Map(sum.map((s) => [s.canonicalUrl, { tier: 1, year: 2010 }]));
    const r = evaluateGates(sum, tier, profile({ freshnessWindowDays: null }), NOW);
    expect(r.gates.find((g) => g.code === "FRESHNESS")?.status).toBe("pass");
  });
});

describe("evaluateKbCovered (T5, pure part)", () => {
  it("should require dense, fresh KB docs plus a positive LLM verdict", () => {
    const kbDocs = [
      { title: "A", path: "a.md" },
      { title: "B", path: "b.md" },
      { title: "C", path: "c.md" },
      { title: "D", path: "d.md" },
    ];
    expect(evaluateKbCovered({ kbDocs, kbFreshRatio: 0.75, kbSufficient: true })).toBe(true);
    // A null LLM verdict is conservative
    expect(evaluateKbCovered({ kbDocs, kbFreshRatio: 0.75, kbSufficient: null })).toBe(false);
    expect(
      evaluateKbCovered({ kbDocs: kbDocs.slice(0, 2), kbFreshRatio: 0.75, kbSufficient: true }),
    ).toBe(false);
    expect(evaluateKbCovered({ kbDocs, kbFreshRatio: 0.5, kbSufficient: true })).toBe(false);
  });
});

describe("combineJudgment (T3)", () => {
  const passStructural = {
    pass: true,
    indeterminate: [] as string[],
    failed: [] as string[],
    gates: [],
  };
  const failStructural = {
    pass: false,
    indeterminate: [] as string[],
    failed: ["DOMAINS"],
    gates: [],
  };
  const indetStructural = {
    pass: true,
    indeterminate: ["FRESHNESS"],
    failed: [] as string[],
    gates: [],
  };

  it("should return sufficient on structural pass without consulting the judge", () => {
    const r = combineJudgment(passStructural, null);
    expect(r.sufficient).toBe(true);
    expect(r.gaps).toEqual([]);
  });

  it("should never let the judge override a structural failure", () => {
    const r = combineJudgment(
      failStructural,
      { sufficient: true, gaps: ["facet X missing"] },
      { sourceCount: 3, domainCount: 2 },
    );
    expect(r.sufficient).toBe(false);
    expect(r.gaps).toContain("facet X missing");
  });

  it("should synthesize gaps from failed gates when no judge ran", () => {
    const r = combineJudgment(failStructural, null, { sourceCount: 3, domainCount: 2 });
    expect(r.sufficient).toBe(false);
    expect(r.gaps).toContain("only 2 domains represented");
  });

  it("should let the judge decide in the indeterminate case", () => {
    const yes = combineJudgment(indetStructural, { sufficient: true, gaps: [] });
    expect(yes.sufficient).toBe(true);
    const no = combineJudgment(indetStructural, { sufficient: false, gaps: ["thin evidence"] });
    expect(no.sufficient).toBe(false);
    expect(no.gaps).toEqual(["thin evidence"]);
  });

  it("should degrade to insufficient with synthesized gaps on judge error", () => {
    const r = combineJudgment(indetStructural, {
      sufficient: false,
      gaps: [],
      error: "429 rate limited",
    });
    expect(r.sufficient).toBe(false);
    expect(r.gaps.length).toBeGreaterThan(0);
    expect(r.gaps[0]).toContain("freshness unverifiable");
  });

  it("should map every failed gate code to a gap message", () => {
    const gaps = synthesizeGaps(
      {
        pass: false,
        failed: ["SOURCES", "DOMAINS", "AUTHORITY", "FRESHNESS"],
        indeterminate: [],
        gates: [],
      },
      3,
      2,
    );
    expect(gaps).toHaveLength(4);
  });
});

describe("evaluateEscalation (T4)", () => {
  const healthy = {
    sufficient: false,
    kbCovered: false,
    llmErrorCount: 0,
    fetchAttempts: 10,
    fetchOk: 9,
    fetchP50Ms: 4000,
    lastRankCount: 12,
    summarized: 12,
    distinctDomains: 5,
    deadlineHit: false,
    targetSources: 15,
    minDomains: 4,
  };

  it("should never escalate when sufficient or KB-covered", () => {
    expect(evaluateEscalation({ ...healthy, sufficient: true }).escalate).toBe(false);
    expect(evaluateEscalation({ ...healthy, kbCovered: true }).escalate).toBe(false);
  });

  it("should never escalate on pipeline health failures", () => {
    const model = evaluateEscalation({ ...healthy, llmErrorCount: 1 });
    expect(model.escalate).toBe(false);
    expect(model.reason).toContain("MODEL_FAILURES");

    const fetch = evaluateEscalation({ ...healthy, fetchAttempts: 10, fetchOk: 4 });
    expect(fetch.escalate).toBe(false);
    expect(fetch.reason).toContain("FETCH_FAILURES");

    const slow = evaluateEscalation({ ...healthy, fetchP50Ms: 25_000 });
    expect(slow.escalate).toBe(false);
    expect(slow.reason).toContain("SLOW_PIPELINE");
  });

  it("should escalate THIN_CANDIDATES when rank returned too few", () => {
    const d = evaluateEscalation({ ...healthy, lastRankCount: 6 });
    expect(d.escalate).toBe(true);
    expect(d.reason).toBe("THIN_CANDIDATES (6<8 candidates)");
  });

  it("should escalate LOW_COVERAGE when below source or domain targets", () => {
    const d = evaluateEscalation({ ...healthy, summarized: 4, distinctDomains: 2 });
    expect(d.escalate).toBe(true);
    expect(d.reason).toContain("LOW_COVERAGE");
    expect(d.reason).toContain("4<15 sources");
    expect(d.reason).toContain("2<4 domains");
  });

  it("should escalate VOLUME_EXHAUSTED when the deadline hit with a healthy pipeline", () => {
    const d = evaluateEscalation({ ...healthy, deadlineHit: true, summarized: 14 });
    expect(d.escalate).toBe(true);
    expect(d.reason).toContain("VOLUME_EXHAUSTED");
  });

  it("should record from:'ASSESS' with every guard snapshot value", () => {
    const d = evaluateEscalation({ ...healthy, lastRankCount: 6 });
    expect(d.from).toBe("ASSESS");
    expect(d.guards).toMatchObject({
      sufficient: false,
      kbCovered: false,
      llmErrors: 0,
      fetchRate: 0.9,
      fetchP50Ms: 4000,
      lastRankCount: 6,
      summarized: 12,
      distinctDomains: 5,
      deadlineHit: false,
    });
  });
});
