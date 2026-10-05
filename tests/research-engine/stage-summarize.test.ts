/**
 * T4: SUMMARIZE fan-out — concurrency ≤ 4, order preservation, and
 * per-URL failure isolation (a rejecting dep records the real error
 * without killing the cycle).
 *
 * @module tests/research-engine/stage-summarize.test
 */

import { mkdtempSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { afterAll, describe, it, expect, vi } from "vitest";

import { runResearch } from "../../extensions/research-engine/orchestrator.js";
import { ASK_QUICK_PROFILE } from "../../extensions/research-engine/profiles.js";

import type {
  ResearchDeps,
  LlmCallInput,
  LlmCallOutcome,
  KbDocWithTitle,
} from "../../extensions/research-engine/research-deps.js";

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

const URLS = [
  "https://a.com/1",
  "https://a.com/2",
  "https://b.com/3",
  "https://b.com/4",
  "https://c.com/5",
  "https://c.com/6",
];

describe("SUMMARIZE fan-out (T4)", () => {
  it("caps concurrency at 4, preserves order, and isolates a rejecting URL", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const summaryOrder: string[] = [];

    const llm = vi.fn(async (input: LlmCallInput): Promise<LlmCallOutcome> => {
      const s = input.system;
      if (s.includes("name: judge")) {
        return Promise.resolve({ ok: true, value: { sufficient: true, gaps: [] } });
      }
      if (s.includes("name: synthesis")) {
        return Promise.resolve({ ok: true, value: "Final answer." });
      }
      if (!s.includes("name: summarizer")) return Promise.resolve({ ok: false, error: "unused" });
      const user = (input as { user?: string }).user ?? "";
      const url = URLS.find((u) => user.includes(u)) ?? "unknown";
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      // Yield so concurrent workers actually overlap.
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      if (url === "https://b.com/3") {
        // A rejecting dep (thrown, not returned) must not kill the cycle.
        throw new Error("provider timeout");
      }
      summaryOrder.push(url);
      return Promise.resolve({ ok: true, value: `Summary of ${url}.` });
    });

    const knowledgeDir = mkdtempSync(join(homedir(), "t4-fanout-"));
    dirs.push(knowledgeDir);
    const deps: ResearchDeps = {
      llm,
      searchSubagent: vi.fn(() =>
        Promise.resolve({
          ok: true,
          value: {
            sources: URLS.map((u) => ({ url: u, title: `T ${u}`, snippet: "s", tier: 3 })),
            coveredFacets: [],
          },
        }),
      ),
      searchDocs: (): Promise<KbDocWithTitle[]> => Promise.resolve([]),
      fetchUrl: (url: string) =>
        Promise.resolve({ content: `<title>Doc ${url}</title><p>body for ${url}</p>` }),
      writeBack: () => Promise.resolve({ created: [], updated: [], skipped: [] }),
      knowledgeDir,
      now: () => Date.parse("2026-10-02T10:00:00Z"),
      fetchConcurrency: 2,
    };

    const state = await runResearch(deps, {
      question: "what is x",
      mode: "breadth",
      profile: ASK_QUICK_PROFILE,
      jobId: "job-t4",
    });

    // Concurrency capped at SUMMARIZE_CONCURRENCY (4)
    expect(maxInFlight).toBeLessThanOrEqual(4);
    // Every successful URL was summarized exactly once (completion order
    // is not asserted — mapLimit guarantees result order, checked next).
    expect([...summaryOrder].sort()).toEqual(URLS.filter((u) => u !== "https://b.com/3").sort());
    // Result order matches input order (b.com/3 excluded)
    expect(state.summaries.map((s) => s.url)).toEqual(URLS.filter((u) => u !== "https://b.com/3"));
    // The rejecting URL gains a failure entry with the real error message
    const failure = state.failures.find((f) => f.url === "https://b.com/3");
    expect(failure).toBeDefined();
    expect(failure?.error).toContain("provider timeout");
    // The cycle continued: terminal state reached with 5 summaries
    expect(state.summaries).toHaveLength(5);
    expect(["DONE_SUFFICIENT", "DONE_DEGRADED"]).toContain(state.stage);
  });
});
