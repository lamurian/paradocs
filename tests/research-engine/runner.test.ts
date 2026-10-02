/**
 * Tests for runResearchEngine — subprocess spawning, concurrency, parsing, dedup.
 * Also covers the research_engine tool registration (R5).
 *
 * @module tests/research-engine/runner.test
 */

import { EventEmitter } from "node:events";

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Spawn mock ───────────────────────────────────────────────────────

interface SpawnCall {
  command: string;
  args: string[];
  options: { env?: Record<string, string | undefined> };
}

const spawnCalls: SpawnCall[] = [];
let activeProcesses = 0;
let maxConcurrent = 0;
/** URL snippets returned per question index (cycled for >2 questions). */
let sourcesPerQuestion: Array<Array<{ url: string; snippet: string }>> = [];
let spawnDelayMs = 10;

vi.mock("node:child_process", () => ({
  spawn: vi.fn((command: string, args: string[], options: { env?: Record<string, string> }) => {
    const callIndex = spawnCalls.length;
    spawnCalls.push({ command, args, options });
    activeProcesses++;
    maxConcurrent = Math.max(maxConcurrent, activeProcesses);

    const stdout = new EventEmitter();
    const stderr = new EventEmitter();
    const questionIdx = callIndex % Math.max(sourcesPerQuestion.length, 1);
    const sources = sourcesPerQuestion[questionIdx] ?? [];

    const child = {
      stdout,
      stderr,
      on: (ev: string, cb: (...a: unknown[]) => void) => {
        if (ev === "close") {
          setTimeout(() => {
            activeProcesses--;
            cb(0);
          }, spawnDelayMs);
        }
      },
      kill: vi.fn(),
    };

    setTimeout(() => {
      const text = JSON.stringify(sources);
      const msg = {
        type: "message_end",
        message: { role: "assistant", content: [{ type: "text", text }] },
      };
      stdout.emit("data", Buffer.from(JSON.stringify(msg) + "\n"));
    }, spawnDelayMs);

    return child;
  }),
}));

// ── runResearchEngine (R2) ──────────────────────────────────────────

describe("runResearchEngine", () => {
  beforeEach(() => {
    spawnCalls.length = 0;
    activeProcesses = 0;
    maxConcurrent = 0;
    sourcesPerQuestion = [
      [
        { url: "https://a.example/1", snippet: "Alpha source one" },
        { url: "https://b.example/2", snippet: "Beta source two" },
      ],
      [
        { url: "https://b.example/2", snippet: "Beta source two" },
        { url: "https://c.example/3", snippet: "Gamma source three" },
      ],
    ];
    spawnDelayMs = 5;
  });

  it("should spawn one subprocess per question with the research engine flags and prompt path", async () => {
    const { runResearchEngine } = await import("../../extensions/research-engine/runner.js");
    const ctx = { cwd: "/test" } as never;

    await runResearchEngine(["question one", "question two"], ctx);

    expect(spawnCalls).toHaveLength(2);
    for (const call of spawnCalls) {
      const argStr = call.args.join(" ");
      expect(argStr).toContain("--mode json");
      expect(argStr).toContain("-p");
      expect(argStr).toContain("--no-session");
      expect(argStr).toContain("--append-system-prompt");
      // Prompt path must point at the researcher.md definition
      const promptIdx = call.args.indexOf("--append-system-prompt");
      expect(promptIdx).toBeGreaterThan(-1);
      expect(call.args[promptIdx + 1]).toContain("researcher.md");
    }
  });

  it("should set PI_RESEARCH_ENGINE=1 in the subprocess env", async () => {
    const { runResearchEngine } = await import("../../extensions/research-engine/runner.js");
    const ctx = { cwd: "/test" } as never;

    await runResearchEngine(["question one"], ctx);

    expect(spawnCalls).toHaveLength(1);
    expect(spawnCalls[0].options.env).toBeDefined();
    expect(spawnCalls[0].options.env?.PI_RESEARCH_ENGINE).toBe("1");
  });

  it("should cap concurrency at 4 processes with 6 questions", async () => {
    const { runResearchEngine } = await import("../../extensions/research-engine/runner.js");
    const ctx = { cwd: "/test" } as never;
    const six = ["q1", "q2", "q3", "q4", "q5", "q6"];

    await runResearchEngine(six, ctx);

    expect(spawnCalls).toHaveLength(6);
    expect(maxConcurrent).toBeLessThanOrEqual(4);
  });

  it("should parse {url, snippet} sources and deduplicate across questions by URL", async () => {
    const { runResearchEngine } = await import("../../extensions/research-engine/runner.js");
    const ctx = { cwd: "/test" } as never;

    const result = await runResearchEngine(["question one", "question two"], ctx);

    expect(result.questions).toEqual(["question one", "question two"]);
    expect(result.sources).toHaveLength(3);
    const urls = result.sources.map((s) => s.url);
    expect(urls).toEqual(["https://a.example/1", "https://b.example/2", "https://c.example/3"]);
    for (const s of result.sources) {
      expect(typeof s.snippet).toBe("string");
      expect(s.snippet.length).toBeGreaterThan(0);
    }
    expect(result.assessment).toBeDefined();
    expect(typeof result.assessment.sufficient).toBe("boolean");
  });
});

// ── research_engine tool registration (R5) ──────────────────────────

vi.mock("../../extensions/research-engine/writeback.js", () => ({
  writeBackToKB: vi.fn(),
}));

describe("research_engine tool registration", () => {
  let registerTool: ReturnType<typeof vi.fn>;
  let on: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.resetModules();
    spawnCalls.length = 0;
    sourcesPerQuestion = [
      [{ url: "https://src.example/1", snippet: "Source one" }],
      [{ url: "https://src.example/2", snippet: "Source two" }],
    ];
    registerTool = vi.fn();
    on = vi.fn();
    const mod = await import("../../extensions/research-engine/index.js");
    mod.default({ registerTool, on } as never);
  });

  it("should register research_engine with a questions: string[] parameter", () => {
    expect(registerTool).toHaveBeenCalledTimes(1);
    const tool = registerTool.mock.calls[0][0] as {
      name: string;
      parameters: {
        properties: Record<string, { type: string; items?: { type: string } }>;
        required: string[];
      };
    };
    expect(tool.name).toBe("research_engine");
    expect(tool.parameters.properties.questions.type).toBe("array");
    expect(tool.parameters.properties.questions.items?.type).toBe("string");
    expect(tool.parameters.required).toContain("questions");
  });

  it("should execute engine then writeback and return sources plus note paths", async () => {
    const { writeBackToKB } = await import("../../extensions/research-engine/writeback.js");
    vi.mocked(writeBackToKB).mockResolvedValue({
      created: ["Resources/new-note.md"],
      updated: ["Resources/outdated-note.md"],
      skipped: [],
    });

    const tool = registerTool.mock.calls[0][0] as {
      execute: (
        id: string,
        params: { questions: string[] },
        signal: undefined,
        onUpdate: undefined,
        ctx: unknown,
      ) => Promise<{
        content: Array<{ type: string; text: string }>;
        details: Record<string, unknown>;
      }>;
    };

    const result = await tool.execute(
      "call",
      { questions: ["question one", "question two"] },
      undefined,
      undefined,
      { cwd: "/test" },
    );

    expect(writeBackToKB).toHaveBeenCalledTimes(1);
    const text = result.content[0].text;
    expect(text).toContain("https://src.example/1");
    expect(text).toContain("https://src.example/2");
    expect(text).toContain("Resources/new-note.md");
    expect(text).toContain("Resources/outdated-note.md");
    expect(result.details.sources).toBeDefined();
    expect(result.details.writeback).toBeDefined();
  });
});
