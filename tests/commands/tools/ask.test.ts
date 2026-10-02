/**
 * Tests for the ask tool — full research pipeline (R8).
 *
 * @module tests/commands/tools/ask.test
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../common/llm.js", () => ({
  callLlmDirect: vi.fn(),
  callLlmWithLoader: vi.fn(),
}));
vi.mock("../../../extensions/research-engine/runner.js", () => ({
  runResearchEngine: vi.fn(),
  MAX_CONCURRENCY: 4,
  MIN_SOURCES: 10,
  RESEARCHER_PROMPT_PATH: "/x/researcher.md",
  getPiInvocation: vi.fn(),
  parseSources: vi.fn(),
}));
vi.mock("../../../extensions/research-engine/writeback.js", () => ({
  writeBackToKB: vi.fn(),
  parseGrouping: vi.fn(),
  GROUPING_PROMPT: "",
}));

const HERE = dirname(fileURLToPath(import.meta.url));
const ASK_TOOL_TS = resolve(HERE, "../../../extensions/commands/tools/ask.ts");

const RESEARCH_RESULT = {
  sources: [
    { url: "https://src.example/1", snippet: "Key point one" },
    { url: "https://src.example/2", snippet: "Key point two" },
  ],
  questions: ["q1"],
  assessment: { sufficient: false, outdatedNotes: [], gaps: [] },
};

const WRITEBACK_RESULT = {
  created: ["Resources/new-note.md"],
  updated: ["Resources/old-note.md"],
  skipped: ["citation unresolved: https://x"],
};

function makeToolCtx(): Record<string, unknown> {
  return {
    cwd: "/test",
    mode: "rpc",
    model: { id: "m", provider: "p" },
    modelRegistry: {
      getApiKeyAndHeaders: vi.fn().mockResolvedValue({ ok: true, apiKey: "sk-test" }),
    },
  };
}

/** Execute a registered ask tool via its execute method. */
async function runAskTool(
  tool: Record<string, unknown>,
  question: string,
): Promise<{
  content: Array<{ type: string; text: string }>;
  details: Record<string, unknown>;
}> {
  const fn = tool.execute as (
    id: string,
    params: { question: string },
    sig: undefined,
    up: undefined,
    ctx: Record<string, unknown>,
  ) => Promise<{
    content: Array<{ type: string; text: string }>;
    details: Record<string, unknown>;
  }>;
  return fn("call", { question }, undefined, undefined, makeToolCtx());
}

/** Get the registered tool definition from a mock registerTool spy. */
function getTool(registerTool: ReturnType<typeof vi.fn>): Record<string, unknown> {
  return registerTool.mock.calls[0][0] as Record<string, unknown>;
}

describe("ask tool — full research pipeline (R8)", () => {
  let registerTool: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.clearAllMocks();
    const { registerAskTool } = await import("../../../extensions/commands/tools/ask.js");
    registerTool = vi.fn();
    registerAskTool({ registerTool, on: vi.fn() } as never);
  });

  it("should register the ask tool with KNOWLEDGE_DIR in description and guidelines", () => {
    const tool = getTool(registerTool);
    expect(tool.name).toBe("ask");
    expect(Object.prototype.hasOwnProperty.call(tool, "promptSnippet")).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(tool, "promptGuidelines")).toBe(true);

    const description = tool.description as string;
    const guidelines = (tool.promptGuidelines as string[]).join("\n");
    expect(description).toContain("KNOWLEDGE_DIR");
    expect(guidelines).toContain("KNOWLEDGE_DIR");
    expect(guidelines).toContain(".env");
  });

  it("should run reformulation, engine, writeback, then synthesis in order", async () => {
    const { callLlmDirect } = await import("../../../common/llm.js");
    const { runResearchEngine } = await import("../../../extensions/research-engine/runner.js");
    const { writeBackToKB } = await import("../../../extensions/research-engine/writeback.js");

    vi.mocked(callLlmDirect).mockImplementation((_m, _a, systemPrompt) => {
      if (systemPrompt.includes("Reformulate")) {
        return Promise.resolve({ ok: true, value: ["q1"] } as never);
      }
      return Promise.resolve({ ok: true, value: "Tool synthesized answer." } as never);
    });
    vi.mocked(runResearchEngine).mockResolvedValue(RESEARCH_RESULT);
    vi.mocked(writeBackToKB).mockResolvedValue(WRITEBACK_RESULT);

    const tool = getTool(registerTool);
    const result = await runAskTool(tool, "What is dopamine?");

    expect(callLlmDirect).toHaveBeenCalledTimes(2);
    expect(runResearchEngine).toHaveBeenCalledWith(["q1"], expect.anything());
    expect(writeBackToKB).toHaveBeenCalledTimes(1);

    const reformOrder = vi.mocked(callLlmDirect).mock.invocationCallOrder[0];
    const engineOrder = vi.mocked(runResearchEngine).mock.invocationCallOrder[0];
    const writebackOrder = vi.mocked(writeBackToKB).mock.invocationCallOrder[0];
    const synthOrder = vi.mocked(callLlmDirect).mock.invocationCallOrder[1];
    expect(reformOrder).toBeLessThan(engineOrder);
    expect(engineOrder).toBeLessThan(writebackOrder);
    expect(writebackOrder).toBeLessThan(synthOrder);

    // Content contains sources, writeback paths, and the answer
    const text = result.content[0].text;
    expect(text).toContain("https://src.example/1");
    expect(text).toContain("https://src.example/2");
    expect(text).toContain("Resources/new-note.md");
    expect(text).toContain("Resources/old-note.md");
    expect(text).toContain("Tool synthesized answer.");

    expect(result.details.sources).toEqual(RESEARCH_RESULT.sources);
    expect(result.details.writeback).toEqual(WRITEBACK_RESULT);
    expect(result.details.answer).toBe("Tool synthesized answer.");
  });

  it("should return a notice without researching when no question is given", async () => {
    const { runResearchEngine } = await import("../../../extensions/research-engine/runner.js");
    const tool = getTool(registerTool);

    const result = await runAskTool(tool, "   ");

    expect(result.content[0].text).toContain("No question provided");
    expect(runResearchEngine).not.toHaveBeenCalled();
  });

  it("should have no direct searchDocs calls in the tool source", () => {
    const source = readFileSync(ASK_TOOL_TS, "utf-8");
    expect(source).not.toContain("searchDocs");
    expect(source).not.toContain("formatAge");
  });
});
