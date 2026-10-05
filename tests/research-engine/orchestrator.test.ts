/**
 * Orchestrator runner tests: full pipeline with stub deps — happy path,
 * KB-context injection, escalation flow, degraded failures, cycle
 * advance, abort.
 *
 * @module tests/research-engine/orchestrator.test
 */

import { mkdtempSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { afterAll, describe, it, expect, vi } from "vitest";

import { loadCheckpoint, checkpointPathFor } from "../../extensions/research-engine/checkpoint.js";
import {
  runResearch,
  DEFAULT_STAGE_MESSAGES,
} from "../../extensions/research-engine/orchestrator.js";
import { ASK_QUICK_PROFILE, RESEARCH_PROFILE } from "../../extensions/research-engine/profiles.js";

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
  const d = mkdtempSync(join(homedir(), "research-orch-test-"));
  dirs.push(d);
  return d;
}

const URLS = [
  "https://a.com/1",
  "https://a.com/2",
  "https://b.com/3",
  "https://b.com/4",
  "https://c.com/5",
  "https://c.com/6",
];

/** Search subagent stub returning the fixture URLs as sources. */
function makeSearchSubagent(
  mode: "ok" | "fail" = "ok",
): ResearchDeps["searchSubagent"] & { mock: { calls: Array<[{ task: string }]> } } {
  const fn = vi.fn((_input: { task: string }): Promise<SearchSubagentOutcome> => {
    if (mode === "fail") return Promise.resolve({ ok: false, error: "429 rate limited" });
    return Promise.resolve({
      ok: true,
      value: {
        sources: URLS.map((u) => ({
          url: u,
          title: `T ${u}`,
          snippet: "Suitable source.",
          tier: 3,
        })),
        coveredFacets: ["mechanisms"],
      },
    });
  });
  return fn;
}

function makeLlm(mode: "ok" | "fail"): ResearchDeps["llm"] {
  return vi.fn((input: LlmCallInput): Promise<LlmCallOutcome> => {
    if (mode === "fail") return Promise.resolve({ ok: false, error: "429 rate limited" });
    const s = input.system;
    if (s.includes("name: summarizer")) {
      return Promise.resolve({ ok: true, value: "A solid grounded summary of the source." });
    }
    if (s.includes("name: judge")) {
      return Promise.resolve({ ok: true, value: { sufficient: true, gaps: [] } });
    }
    if (s.includes("name: synthesis")) {
      return Promise.resolve({ ok: true, value: "The final synthesized answer." });
    }
    return Promise.resolve({ ok: false, error: "unknown prompt" });
  });
}

function makeDeps(
  overrides: Partial<ResearchDeps> & {
    llm?: ResearchDeps["llm"];
    searchSubagent?: ResearchDeps["searchSubagent"];
  } = {},
): {
  deps: ResearchDeps;
  knowledgeDir: string;
  appendEntry: ReturnType<typeof vi.fn>;
  notify: ReturnType<typeof vi.fn>;
  progress: Array<[string, string]>;
} {
  const knowledgeDir = tmp();
  const appendEntry = vi.fn();
  const notify = vi.fn();
  const progress: Array<[string, string]> = [];
  const deps: ResearchDeps = {
    llm: overrides.llm ?? makeLlm("ok"),
    searchSubagent: overrides.searchSubagent ?? makeSearchSubagent("ok"),
    searchDocs: (): Promise<KbDocWithTitle[]> => Promise.resolve([]),
    fetchUrl: (url: string) =>
      Promise.resolve({ content: `<title>Doc ${url}</title><p>body content for ${url}</p>` }),
    writeBack: () => Promise.resolve({ created: ["Resources/note.md"], updated: [], skipped: [] }),
    knowledgeDir,
    now: () => Date.parse("2026-10-02T10:00:00Z"),
    appendEntry,
    notify,
    onProgress: (stage, message) => progress.push([stage, message]),
    fetchConcurrency: 2,
    ...overrides,
  };
  return { deps, knowledgeDir, appendEntry, notify, progress };
}

describe("runResearch — orchestrator pipeline", () => {
  it("should run quick mode to DONE_SUFFICIENT with progress + checkpoint", async () => {
    const { deps, knowledgeDir, progress } = makeDeps();
    const state = await runResearch(deps, {
      question: "what is x",
      mode: "breadth",
      profile: ASK_QUICK_PROFILE,
      jobId: "job-happy",
    });

    expect(state.stage).toBe("DONE_SUFFICIENT");
    expect(state.summaries).toHaveLength(6);
    expect(state.writeback?.created).toEqual(["Resources/note.md"]);
    expect(state.synthesis).toBe("The final synthesized answer.");

    const stages = progress.map(([s]) => s);
    expect(stages).toEqual(
      expect.arrayContaining([
        "QUERY_GEN",
        "SEARCH",
        "RANK",
        "FETCH",
        "SUMMARIZE",
        "ASSESS",
        "SYNTHESIZE",
        "WRITE_BACK",
      ]),
    );
    const messages = progress.map(([, m]) => m);
    expect(messages).toContain(DEFAULT_STAGE_MESSAGES.QUERY_GEN);

    const loaded = loadCheckpoint(checkpointPathFor(knowledgeDir, "job-happy"));
    expect(loaded).not.toBeNull();
    expect(loaded!.state.stage).toBe("DONE_SUFFICIENT");
  });

  it("should inject KB doc titles into the search subagent task", async () => {
    const kbDocs: KbDocWithTitle[] = [
      { title: "Harness Overview", path: "harness-overview.md", created: "2026-05-01" },
      { title: "Loop Anatomy", path: "loop-anatomy.md", created: "2026-06-01" },
    ];
    const searchSubagent = makeSearchSubagent();
    const { deps } = makeDeps({ searchDocs: () => Promise.resolve(kbDocs), searchSubagent });

    await runResearch(deps, {
      question: "what is x",
      mode: "breadth",
      profile: ASK_QUICK_PROFILE,
      jobId: "job-kb",
    });

    const calls = searchSubagent.mock.calls;
    const tasks = calls.map((c) => c[0].task);
    expect(tasks[0]).toContain("Harness Overview");
    expect(tasks[0]).toContain("Loop Anatomy");
    expect(tasks[0]).toContain("context only");
  });

  it("should escalate to ESCALATED with appendEntry + notify on thin candidates", async () => {
    const llm = vi.fn((input: LlmCallInput): Promise<LlmCallOutcome> => {
      const s = input.system;
      if (s.includes("name: summarizer")) {
        // only 2 of 6 produce summaries → structural SOURCES fail
        const user = (input as { user?: string }).user ?? "";
        const idx = URLS.findIndex((u) => user.includes(u));
        return Promise.resolve(
          idx < 2 ? { ok: true, value: "Summary here." } : { ok: true, value: "IRRELEVANT" },
        );
      }
      if (s.includes("name: judge")) {
        return Promise.resolve({ ok: true, value: { sufficient: false, gaps: ["more sources"] } });
      }
      return Promise.resolve({ ok: false, error: "unused" });
    });
    const { deps, appendEntry, notify } = makeDeps({ llm, allowEscalation: true });

    const state = await runResearch(deps, {
      question: "what is x",
      mode: "breadth",
      profile: ASK_QUICK_PROFILE,
      jobId: "job-esc",
    });

    expect(state.stage).toBe("ESCALATED");
    expect(state.escalation?.escalate).toBe(true);
    expect(state.escalation?.reason).toContain("THIN_CANDIDATES");
    expect(appendEntry).toHaveBeenCalledWith(
      "research_escalation",
      expect.objectContaining({ from: "ASSESS" }),
    );
    expect(notify).toHaveBeenCalledWith(expect.stringContaining("research escalated"));
  });

  it("should degrade to DONE_DEGRADED when every LLM call fails", async () => {
    const { deps } = makeDeps({
      llm: makeLlm("fail"),
      searchSubagent: makeSearchSubagent("fail"),
      writeBack: () =>
        Promise.resolve({
          created: [],
          updated: [],
          skipped: ["write-back skipped: grouping failed: 429 rate limited"],
        }),
    });

    const state = await runResearch(deps, {
      question: "what is x",
      mode: "breadth",
      profile: ASK_QUICK_PROFILE,
      jobId: "job-fail",
    });

    expect(state.stage).toBe("DONE_DEGRADED");
    expect(state.synthesisError).toContain("429 rate limited");
    expect(state.llmErrorCount).toBeGreaterThan(0);
    expect(state.failures.length).toBeGreaterThan(0);
    expect(state.writeback?.skipped[0]).toContain("grouping failed");
  });

  it("should advance cycles with deterministic refine and record the question", async () => {
    const { deps } = makeDeps();
    const state = await runResearch(deps, {
      question: "AI agent guardrails",
      mode: "breadth",
      profile: RESEARCH_PROFILE,
      jobId: "job-research",
    });
    // The question is recorded per cycle; subagent handles query formulation.
    expect(state.askedQuestions).toContain("AI agent guardrails");
    // Never sufficient within a single quick pass (6 < 15 target) → degraded terminal
    expect(["DONE_DEGRADED", "DONE_SUFFICIENT"]).toContain(state.stage);
  });

  it("should cancel to CANCELLED when the signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const { deps } = makeDeps({ signal: controller.signal });
    const state = await runResearch(deps, {
      question: "what is x",
      mode: "breadth",
      profile: ASK_QUICK_PROFILE,
      jobId: "job-abort",
    });
    expect(state.stage).toBe("CANCELLED");
  });
});
