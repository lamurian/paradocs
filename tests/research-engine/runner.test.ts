/**
 * Tests for the search-stage runner (T1 args builder, T3 parseSearchResult).
 *
 * Replaces the old runResearchEngine suite: the search stage now spawns
 * one lean pi subagent with the web_search tool; the runner builds the
 * exact CLI args (literal researcher.md prompt text — never the path)
 * and validates the subagent's {sources, coveredFacets} JSON contract.
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, it, expect, vi } from "vitest";

// Passthrough self-mock + resetModules: with test.isolate=false the shared
// module registry can hand us a runner.js instance already evaluated in an
// earlier file's context, bound to that file's factory mock of
// common/subagent.js (a bare vi.fn()), which makes buildSubagentArgs return
// undefined. resetModules forces runner.js to re-evaluate against this
// file's registration — importOriginal, i.e. the real implementation.
vi.mock("../../common/subagent.js", async (importOriginal) =>
  importOriginal<typeof import("../../common/subagent.js")>(),
);

vi.resetModules();

const {
  WEB_SEARCH_EXT_PATH,
  buildSearchAgentArgs,
  buildSearchTask,
  parseSearchResult,
  runSearchStage,
} = await import("../../extensions/research-engine/runner.js");

import type { ResearchState } from "../../extensions/research-engine/state.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const RESEARCHER_MD = resolve(HERE, "../../extensions/research-engine/prompts/researcher.md");

// ── T1: buildSearchAgentArgs ──────────────────────────────────────────

describe("buildSearchAgentArgs (T1)", () => {
  it("produces the exact lean search-subagent CLI in contract order", () => {
    const args = buildSearchAgentArgs({
      provider: "opencode-go",
      modelId: "mimo-v2.5",
      task: "research agentic harnesses",
    });

    expect(args).toEqual([
      "--mode",
      "json",
      "-p",
      "--no-session",
      "--no-extensions",
      "-e",
      WEB_SEARCH_EXT_PATH,
      "--tools",
      "web_search",
      "--offline",
      "--thinking",
      "minimal",
      "--no-context-files",
      "--no-skills",
      "--provider",
      "opencode-go",
      "--model",
      "mimo-v2.5",
      "--append-system-prompt",
      expect.any(String) as unknown as string,
      "Task: research agentic harnesses",
    ]);
  });

  it("passes the literal researcher.md contents to --append-system-prompt, never the path", () => {
    const fileText = readFileSync(RESEARCHER_MD, "utf-8");
    const args = buildSearchAgentArgs({ provider: "p", modelId: "m", task: "t" });

    const promptIdx = args.indexOf("--append-system-prompt");
    expect(promptIdx).toBeGreaterThan(-1);
    expect(args[promptIdx + 1]).toBe(fileText);
    expect(args[promptIdx + 1]).not.toBe(RESEARCHER_MD);
    expect(args[promptIdx + 1]).not.toContain("researcher.md");
  });

  it("ends with the Task: positional prompt", () => {
    const args = buildSearchAgentArgs({ provider: "p", modelId: "m", task: "find X sources" });
    expect(args[args.length - 1].startsWith("Task: ")).toBe(true);
    expect(args[args.length - 1]).toBe("Task: find X sources");
  });

  it("resolves the web-search extension path under extensions/web-search", () => {
    expect(WEB_SEARCH_EXT_PATH.endsWith("web-search")).toBe(true);
    const args = buildSearchAgentArgs({ provider: "p", modelId: "m", task: "t" });
    expect(args[args.indexOf("-e") + 1]).toBe(WEB_SEARCH_EXT_PATH);
  });
});

// ── T3: parseSearchResult ─────────────────────────────────────────────

describe("parseSearchResult (T3)", () => {
  it("parses valid sources and coveredFacets", () => {
    const text = JSON.stringify({
      sources: [
        { url: "https://a.example/1", title: "A", snippet: "Alpha point", tier: 1 },
        { url: "https://b.example/2", snippet: "Beta point" },
      ],
      coveredFacets: ["loop mechanics"],
    });
    const result = parseSearchResult(text);
    expect(result).not.toBeNull();
    expect(result?.sources).toHaveLength(2);
    expect(result?.sources[0]).toEqual({
      url: "https://a.example/1",
      title: "A",
      snippet: "Alpha point",
      tier: 1,
    });
    expect(result?.coveredFacets).toEqual(["loop mechanics"]);
  });

  it("defaults coveredFacets to [] when missing", () => {
    const text = JSON.stringify({ sources: [{ url: "https://a.example/1", snippet: "s" }] });
    const result = parseSearchResult(text);
    expect(result?.coveredFacets).toEqual([]);
  });

  it("drops malformed entries (missing url or non-string snippet)", () => {
    const text = JSON.stringify({
      sources: [
        { snippet: "no url here" },
        { url: "https://ok.example/1", snippet: 42 },
        { url: "https://good.example/1", snippet: "kept" },
      ],
    });
    const result = parseSearchResult(text);
    expect(result?.sources).toHaveLength(1);
    expect(result?.sources[0].url).toBe("https://good.example/1");
  });

  it("deduplicates URLs keeping the first occurrence", () => {
    const text = JSON.stringify({
      sources: [
        { url: "https://dup.example/1", snippet: "first" },
        { url: "https://dup.example/1", snippet: "second" },
        { url: "https://other.example/2", snippet: "other" },
      ],
    });
    const result = parseSearchResult(text);
    expect(result?.sources).toHaveLength(2);
    expect(result?.sources[0].snippet).toBe("first");
  });

  it("returns null for non-JSON text", () => {
    expect(parseSearchResult("not json at all")).toBeNull();
  });

  it("returns null for non-object JSON", () => {
    expect(parseSearchResult("[1,2,3]")).toBeNull();
    expect(parseSearchResult('"just a string"')).toBeNull();
  });

  it("returns null when sources is missing or not an array", () => {
    expect(parseSearchResult("{}")).toBeNull();
    expect(parseSearchResult('{"sources":"nope"}')).toBeNull();
  });

  it("tolerates markdown fences around the JSON", () => {
    const text = '```json\n{"sources":[{"url":"https://a.example/1","snippet":"s"}]}\n```';
    const result = parseSearchResult(text);
    expect(result?.sources).toHaveLength(1);
  });
});

// ── buildSearchTask context branches ───────────────────────────────────

function taskState(overrides: Partial<ResearchState> = {}): ResearchState {
  return {
    jobId: "j",
    question: "how do harnesses work",
    mode: "depth",
    profile: {
      name: "ask-deep",
      targetSources: 10,
      maxCycles: 3,
      deadlineMs: 600_000,
      minDomains: 3,
      requireAuthoritative: true,
      freshnessWindowDays: 365,
    },
    stage: "SEARCH",
    cycle: 2,
    startedAt: 0,
    deadlineAt: 1,
    queries: ["q1"],
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
    gaps: [],
    cycles: [],
    failures: [],
    llmErrorCount: 0,
    deadlineHit: false,
    degraded: false,
    trace: [],
    ...overrides,
  };
}

describe("buildSearchTask", () => {
  it("includes question, phase, and KB context only when docs exist", () => {
    const bare = buildSearchTask(taskState());
    expect(bare).toContain("how do harnesses work");
    expect(bare).toContain("depth (cycle 2)");
    expect(bare).toContain("KB documents: none found");
    expect(bare).not.toContain("Known gaps");
    expect(bare).not.toContain("already collected");

    const full = buildSearchTask(
      taskState({
        kbDocs: [{ title: "Harness Overview", path: "h.md", date: "2026-05-01" }],
        gaps: ["missing evaluation metrics"],
        coveredFacets: ["tooling"],
        visited: ["https://old.example/1"],
        askedQuestions: ["old question"],
      }),
    );
    expect(full).toContain("Harness Overview");
    expect(full).toContain("2026-05-01");
    expect(full).toContain("missing evaluation metrics");
    expect(full).toContain("tooling");
    expect(full).toContain("https://old.example/1");
    expect(full).toContain("old question");
  });

  it("labels the breadth phase for cycle 1", () => {
    const task = buildSearchTask(taskState({ mode: "breadth", cycle: 1 }));
    expect(task).toContain("breadth");
  });
});

// ── runSearchStage failure mapping ───────────────────────────────────

describe("runSearchStage", () => {
  it("maps a failing subagent to search_done with the real error", async () => {
    const deps = {
      searchSubagent: () => Promise.resolve({ ok: false, error: "spawn ENOENT" }),
    } as never;
    const ev = await runSearchStage(taskState(), deps);
    expect(ev.type).toBe("search_done");
    if (ev.type === "search_done") {
      expect(ev.candidates).toEqual([]);
      expect(ev.llmErrors).toBe(1);
      expect(ev.failures?.[0]?.error).toBe("spawn ENOENT");
    }
  });

  it("canonicalizes, dedupes, and filters visited URLs from subagent sources", async () => {
    const deps = {
      searchSubagent: () =>
        Promise.resolve({
          ok: true,
          value: {
            sources: [
              { url: "https://new.example/a?q=1", title: "A", snippet: "s", tier: 1 },
              { url: "https://old.example/1", snippet: "visited" },
              { url: "https://new.example/a?q=1", snippet: "dup" },
              { url: "https://bare.example/b", snippet: "no tier" },
            ],
            coveredFacets: ["mechanisms"],
          },
        }),
    } as never;
    const ev = await runSearchStage(taskState({ visited: ["https://old.example/1"] }), deps);
    expect(ev.type).toBe("search_done");
    if (ev.type === "search_done") {
      expect(ev.candidates.map((c) => c.canonicalUrl)).toEqual([
        "https://new.example/a?q=1",
        "https://bare.example/b",
      ]);
      expect(ev.candidates[0].tier).toBe(1);
      expect(ev.candidates[1].tier).toBe(3);
      expect(ev.coveredFacets).toEqual(["mechanisms"]);
      expect(ev.llmErrors).toBe(0);
    }
  });
});
