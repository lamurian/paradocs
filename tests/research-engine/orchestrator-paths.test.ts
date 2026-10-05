/**
 * Orchestrator extended stage paths: chunked map-reduce summarize,
 * head+tail flag, write-back failure surfacing, synthesis fallback,
 * per-transition checkpoint trace.
 *
 * @module tests/research-engine/orchestrator-paths.test
 */

import { mkdtempSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { afterAll, describe, it, expect, vi } from "vitest";

import { loadCheckpoint, checkpointPathFor } from "../../extensions/research-engine/checkpoint.js";
import { runResearch } from "../../extensions/research-engine/orchestrator.js";
import { ASK_QUICK_PROFILE } from "../../extensions/research-engine/profiles.js";

import type {
  ResearchDeps,
  LlmCallInput,
  LlmCallOutcome,
  KbDocWithTitle,
  SearchSubagentOutcome,
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

function tmp(): string {
  const d = mkdtempSync(join(homedir(), "research-orch-paths-test-"));
  dirs.push(d);
  return d;
}

const URLS = ["https://a.com/1", "https://b.com/2"];

function makeSearchSubagent(): ResearchDeps["searchSubagent"] {
  return vi.fn(
    (): Promise<SearchSubagentOutcome> =>
      Promise.resolve({
        ok: true,
        value: {
          sources: URLS.map((u) => ({ url: u, title: `T ${u}`, snippet: "s", tier: 3 })),
          coveredFacets: [],
        },
      }),
  );
}

function makeDeps(overrides: Partial<ResearchDeps> = {}): {
  deps: ResearchDeps;
  knowledgeDir: string;
} {
  const knowledgeDir = tmp();
  const deps: ResearchDeps = {
    llm: vi.fn((input: LlmCallInput): Promise<LlmCallOutcome> => {
      const s = input.system;
      if (s.includes("name: summarizer")) {
        return Promise.resolve({ ok: true, value: "Chunk summary." });
      }
      if (s.includes("name: judge")) {
        return Promise.resolve({ ok: true, value: { sufficient: false, gaps: ["g"] } });
      }
      if (s.includes("name: synthesis")) return Promise.resolve({ ok: true, value: "Answer." });
      return Promise.resolve({ ok: true, value: "" });
    }),
    searchSubagent: makeSearchSubagent(),
    searchDocs: (): Promise<KbDocWithTitle[]> => Promise.resolve([]),
    fetchUrl: (url: string) => Promise.resolve({ content: `<title>Doc ${url}</title><p>body</p>` }),
    writeBack: () => Promise.resolve({ created: [], updated: [], skipped: [] }),
    knowledgeDir,
    now: () => Date.parse("2026-10-02T10:00:00Z"),
    ...overrides,
  };
  return { deps, knowledgeDir };
}

describe("runResearch — extended stage paths", () => {
  it("should run chunked map-reduce summarize for long docs (one merge call)", async () => {
    const summarizerUsers: string[] = [];
    const llm = vi.fn((input: LlmCallInput): Promise<LlmCallOutcome> => {
      const s = input.system;
      if (s.includes("name: summarizer")) {
        summarizerUsers.push(input.user);
        return Promise.resolve({ ok: true, value: "Chunk summary." });
      }
      if (s.includes("name: judge")) {
        return Promise.resolve({ ok: true, value: { sufficient: false, gaps: ["g"] } });
      }
      if (s.includes("name: synthesis")) return Promise.resolve({ ok: true, value: "Answer." });
      return Promise.resolve({ ok: true, value: "" });
    });
    const { deps } = makeDeps({
      llm,
      fetchUrl: () => Promise.resolve({ content: "x".repeat(60_000) }),
    });

    const state = await runResearch(deps, {
      question: "q",
      mode: "breadth",
      profile: ASK_QUICK_PROFILE,
      jobId: "job-chunk",
    });

    const merges = summarizerUsers.filter((u) => u.includes("Merge these part summaries"));
    // Both fetched records exceed the whole-doc cap → one merge call each
    expect(merges.length).toBeGreaterThanOrEqual(1);
    expect(state.summaries.length).toBeGreaterThanOrEqual(1);
    expect(state.summaries[0].summary).toBe("Chunk summary.");
  });

  it("should flag head+tail summaries for very long docs", async () => {
    const { deps } = makeDeps({
      fetchUrl: () => Promise.resolve({ content: "y".repeat(250_000) }),
    });
    const state = await runResearch(deps, {
      question: "q",
      mode: "breadth",
      profile: ASK_QUICK_PROFILE,
      jobId: "job-headtail",
    });
    expect(state.summaries[0].truncation).toBe("head_tail");
  });

  it("should surface write-back failures as skipped lines", async () => {
    const { deps } = makeDeps({
      writeBack: () => Promise.reject(new Error("kb offline")),
    });
    const state = await runResearch(deps, {
      question: "q",
      mode: "breadth",
      profile: ASK_QUICK_PROFILE,
      jobId: "job-wbthrow",
    });
    expect(state.writeback?.skipped[0]).toContain("write-back failed: kb offline");
  });

  it("should fall back to KB doc listings when synthesis and summaries are empty", async () => {
    const llm = vi.fn((input: LlmCallInput): Promise<LlmCallOutcome> => {
      const s = input.system;
      if (s.includes("name: summarizer")) return Promise.resolve({ ok: true, value: "" });
      if (s.includes("name: judge")) {
        return Promise.resolve({ ok: true, value: { sufficient: false, gaps: ["g"] } });
      }
      if (s.includes("name: synthesis")) {
        return Promise.resolve({ ok: false, error: "synthesis endpoint down" });
      }
      return Promise.resolve({ ok: true, value: "" });
    });
    const { deps } = makeDeps({
      llm,
      searchDocs: (): Promise<KbDocWithTitle[]> =>
        Promise.resolve([
          { title: "Doc A", path: "Resources/a.md", created: "2026-05-01" },
          { title: "Doc B", path: "Resources/b.md", created: "2026-06-01" },
          { title: "Doc C", path: "Resources/c.md", created: "2026-07-01" },
        ]),
    });
    const state = await runResearch(deps, {
      question: "q",
      mode: "breadth",
      profile: ASK_QUICK_PROFILE,
      jobId: "job-kb2",
    });
    // Deterministic fallback: KB doc titles/paths preserved in the body.
    expect(state.synthesis).toContain("Doc A (Resources/a.md)");
    expect(state.synthesisError).toContain("synthesis endpoint down");
  });

  it("should record a checkpoint trace for every transition", async () => {
    const { deps, knowledgeDir } = makeDeps();
    await runResearch(deps, {
      question: "q",
      mode: "breadth",
      profile: ASK_QUICK_PROFILE,
      jobId: "job-trace",
    });
    const loaded = loadCheckpoint(checkpointPathFor(knowledgeDir, "job-trace"));
    expect(loaded).not.toBeNull();
    expect(loaded!.state.trace.length).toBeGreaterThanOrEqual(8);
    expect(loaded!.lastTransition).toEqual(loaded!.state.trace.at(-1));
  });
});
