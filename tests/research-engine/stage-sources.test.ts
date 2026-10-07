/**
 * T1: FETCH stage detail channel — stageFetch wraps deps.fetchUrl so
 * every completed URL emits a 'fetched i/N' onDetail message.
 *
 * @module tests/research-engine/stage-sources.test
 */

import { describe, it, expect, vi } from "vitest";

import { ASK_QUICK_PROFILE } from "../../extensions/research-engine/profiles.js";
import { stageFetch } from "../../extensions/research-engine/stage-sources.js";

import type { ResearchDeps } from "../../extensions/research-engine/research-deps.js";
import type { Candidate, ResearchState } from "../../extensions/research-engine/state.js";

vi.mock("../../common/subagent.js", () => ({
  buildSubagentArgs: vi.fn(),
  getPiInvocation: vi.fn(),
  resolveSubagentTimeoutMs: vi.fn(() => 60_000),
  runSubagent: vi.fn(),
}));

const NOW = Date.parse("2026-10-02T10:00:00Z");

/** Build a FETCH-stage state around the given candidates. */
function fetchState(candidates: Candidate[], visited: string[] = []): ResearchState {
  return {
    jobId: "job-stage-sources",
    question: "what is x",
    mode: "breadth",
    profile: ASK_QUICK_PROFILE,
    stage: "FETCH",
    cycle: 1,
    startedAt: NOW,
    deadlineAt: NOW + 900_000,
    queries: ["what is x"],
    kbDocs: [],
    kbSufficient: null,
    kbFreshRatio: null,
    kbCovered: false,
    candidates,
    lastRankCount: candidates.length,
    fetches: [],
    summaries: [],
    visited,
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

function candidate(url: string, canonicalUrl = url): Candidate {
  return { url, canonicalUrl, tier: 3, query: "what is x" };
}

describe("stageFetch onDetail emissions (T1)", () => {
  it("emits 'fetched i/N' once per completed URL", async () => {
    const detailMessages: string[] = [];
    const deps = {
      fetchUrl: vi.fn((url: string) =>
        Promise.resolve({ title: `T ${url}`, content: `<p>body ${url}</p>` }),
      ),
      onDetail: (message: string) => detailMessages.push(message),
    } as unknown as ResearchDeps;

    const state = fetchState([
      candidate("https://a.com/1"),
      candidate("https://a.com/2"),
      candidate("https://a.com/3"),
    ]);
    const event = await stageFetch(state, deps, () => NOW);

    expect(event.type).toBe("fetched");
    if (event.type === "fetched") expect(event.records).toHaveLength(3);
    expect([...detailMessages].sort()).toEqual(["fetched 1/3", "fetched 2/3", "fetched 3/3"]);
  });

  it("counts only unvisited unique URLs in the i/N total", async () => {
    const detailMessages: string[] = [];
    const deps = {
      fetchUrl: vi.fn((url: string) => Promise.resolve({ content: `<p>${url}</p>` })),
      onDetail: (message: string) => detailMessages.push(message),
    } as unknown as ResearchDeps;

    const state = fetchState(
      [
        candidate("https://a.com/1"),
        candidate("https://a.com/1"), // duplicate — deduped
        candidate("https://a.com/2"),
      ],
      ["https://a.com/2"], // already visited — skipped
    );
    await stageFetch(state, deps, () => NOW);

    expect(deps.fetchUrl).toHaveBeenCalledTimes(1);
    expect(detailMessages).toEqual(["fetched 1/1"]);
  });

  it("counts a failed fetch as completed so i still reaches N", async () => {
    const detailMessages: string[] = [];
    const deps = {
      fetchUrl: vi.fn((url: string) =>
        url.includes("bad")
          ? Promise.resolve({ error: "Request timed out" })
          : Promise.resolve({ content: `<p>${url}</p>` }),
      ),
      onDetail: (message: string) => detailMessages.push(message),
    } as unknown as ResearchDeps;

    const state = fetchState([candidate("https://a.com/good"), candidate("https://a.com/bad")]);
    const event = await stageFetch(state, deps, () => NOW);

    if (event.type === "fetched") {
      expect(event.records.filter((r) => r.ok)).toHaveLength(1);
      expect(event.records.filter((r) => !r.ok)).toHaveLength(1);
    }
    expect([...detailMessages].sort()).toEqual(["fetched 1/2", "fetched 2/2"]);
  });
});
