/**
 * Orchestrator runner tests: full pipeline with stub deps — happy path,
 * KB-covered short-circuit, escalation flow, degraded LLM failures,
 * /research facet fill, abort.
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
} from "../../extensions/research-engine/research-deps.js";
import type { SearchWebResult } from "../../extensions/research-engine/search.js";

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

function makeLlm(mode: "ok" | "fail"): ResearchDeps["llm"] {
  return vi.fn((input: LlmCallInput): Promise<LlmCallOutcome> => {
    if (mode === "fail") return Promise.resolve({ ok: false, error: "429 rate limited" });
    const s = input.system;
    if (s.includes("name: query-gen")) {
      return Promise.resolve({ ok: true, value: { queries: ["q1", "q2"], kbSufficient: false } });
    }
    if (s.includes("name: rank")) {
      return Promise.resolve({ ok: true, value: URLS });
    }
    if (s.includes("name: summarizer")) {
      return Promise.resolve({ ok: true, value: "A solid grounded summary of the source." });
    }
    if (s.includes("name: judge")) {
      return Promise.resolve({ ok: true, value: { sufficient: true, gaps: [] } });
    }
    if (s.includes("name: reformulate")) {
      return Promise.resolve({
        ok: true,
        value: { questions: ["q3"], coveredFacets: ["tooling"] },
      });
    }
    if (s.includes("name: synthesis")) {
      return Promise.resolve({ ok: true, value: "The final synthesized answer." });
    }
    return Promise.resolve({ ok: false, error: "unknown prompt" });
  });
}

function makeDeps(overrides: Partial<ResearchDeps> & { llm?: ResearchDeps["llm"] } = {}): {
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
    searchDocs: (): Promise<KbDocWithTitle[]> => Promise.resolve([]),
    fetchUrl: (url: string) =>
      Promise.resolve({ content: `<title>Doc ${url}</title><p>body content for ${url}</p>` }),
    writeBack: () => Promise.resolve({ created: ["Resources/note.md"], updated: [], skipped: [] }),
    knowledgeDir,
    now: () => Date.parse("2026-10-02T10:00:00Z"),
    appendEntry,
    notify,
    onProgress: (stage, message) => progress.push([stage, message]),
    searchDeps: {
      searchWeb: (): Promise<SearchWebResult> =>
        Promise.resolve({
          results: URLS.map((u) => ({ url: u, title: `T ${u}`, snippet: "s" })),
          tier: 3,
        }),
    },
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

  it("should short-circuit from QUERY_GEN when the KB covers the question", async () => {
    const kbDocs: KbDocWithTitle[] = [
      { title: "A", path: "a.md", created: "2026-05-01" },
      { title: "B", path: "b.md", created: "2026-06-01" },
      { title: "C", path: "c.md", created: "2026-07-01" },
      { title: "D", path: "d.md", created: "2026-08-01" },
    ];
    const llm = vi.fn((input: LlmCallInput): Promise<LlmCallOutcome> => {
      if (input.system.includes("name: query-gen")) {
        return Promise.resolve({ ok: true, value: { queries: ["q1"], kbSufficient: true } });
      }
      return Promise.resolve({ ok: true, value: "KB-based answer." });
    });
    const { deps } = makeDeps({ llm, searchDocs: () => Promise.resolve(kbDocs) });

    const state = await runResearch(deps, {
      question: "what is x",
      mode: "breadth",
      profile: ASK_QUICK_PROFILE,
      jobId: "job-kb",
    });

    expect(state.stage).toBe("DONE_SUFFICIENT");
    expect(state.kbCovered).toBe(true);
    expect(state.summaries).toEqual([]);
    // No summarize calls: only query-gen + synthesis LLM calls happened
    const systems = llm.mock.calls.map((c) => c[0].system);
    expect(systems.some((s) => s.includes("name: summarizer"))).toBe(false);
  });

  it("should escalate to ESCALATED with appendEntry + notify on thin candidates", async () => {
    const llm = vi.fn((input: LlmCallInput): Promise<LlmCallOutcome> => {
      const s = input.system;
      if (s.includes("name: query-gen")) {
        return Promise.resolve({ ok: true, value: { queries: ["q1"], kbSufficient: false } });
      }
      if (s.includes("name: rank")) return Promise.resolve({ ok: true, value: URLS });
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
      writeBack: () =>
        Promise.resolve({
          created: [],
          updated: [],
          skipped: ["write-back skipped: grouping LLM call failed: 429"],
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
    expect(state.writeback?.skipped[0]).toContain("grouping LLM call failed");
  });

  it("should respect the /research profile breadth facet-fill", async () => {
    const { deps } = makeDeps();
    const state = await runResearch(deps, {
      question: "AI agent guardrails",
      mode: "breadth",
      profile: RESEARCH_PROFILE,
      jobId: "job-research",
    });
    // Facet fill expands cycle-1 queries to the full template (recorded in askedQuestions)
    expect(state.askedQuestions.length).toBeGreaterThanOrEqual(5);
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
