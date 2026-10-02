/**
 * Tests for the /research command — research engine flow (R7),
 * cleanup of old sufficiency modules (R9), and KNOWLEDGE_DIR descriptions (R10).
 *
 * @module tests/commands/research.test
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../common/llm.js", () => ({
  callLlmDirect: vi.fn(),
  callLlmWithLoader: vi.fn(),
}));
vi.mock("../../extensions/research-engine/runner.js", () => ({
  runResearchEngine: vi.fn(),
  MAX_CONCURRENCY: 4,
  MIN_SOURCES: 10,
  RESEARCHER_PROMPT_PATH: "/x/researcher.md",
  getPiInvocation: vi.fn(),
  parseSources: vi.fn(),
}));
vi.mock("../../extensions/research-engine/writeback.js", () => ({
  writeBackToKB: vi.fn(),
  parseGrouping: vi.fn(),
  GROUPING_PROMPT: "",
}));

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../..");
const EXT_DIR = resolve(ROOT, "extensions");

const QUESTION_TREE = {
  why: { question: "Why is X important?", supporting: ["W1", "W2"] },
  how: { question: "How does X work?", supporting: ["H1"] },
};

const RESEARCH_RESULT = {
  sources: [{ url: "https://src.example/1", snippet: "Key point" }],
  questions: ["Why is X important?", "W1", "W2", "How does X work?", "H1"],
  assessment: { sufficient: false, outdatedNotes: [], gaps: [] },
};

const WRITEBACK_RESULT = {
  created: ["Resources/x-note.md"],
  updated: [],
  skipped: [],
};

/** Recursively collect .ts files under a directory. */
function collectTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...collectTsFiles(full));
    } else if (entry.endsWith(".ts")) {
      out.push(full);
    }
  }
  return out;
}

function makeCtx(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ui: { notify: vi.fn(), custom: vi.fn() },
    cwd: "/test",
    mode: "rpc",
    model: { id: "m", provider: "p" },
    modelRegistry: {
      getApiKeyAndHeaders: vi.fn().mockResolvedValue({ ok: true, apiKey: "sk-test" }),
    },
    ...overrides,
  };
}

describe("/research command — research engine flow (R7)", () => {
  let sendUserMessage: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    sendUserMessage = vi.fn();
  });

  it("should show usage when no topic is provided", async () => {
    const { createHandler } = await import("../../extensions/commands/research.js");
    const notify = vi.fn();
    const handler = createHandler({ sendUserMessage } as never);

    await handler("", makeCtx({ ui: { notify } }) as never);

    expect(notify).toHaveBeenCalledWith(expect.stringContaining("Usage: /research"), "warning");
    expect(sendUserMessage).not.toHaveBeenCalled();
  });

  it("should require a selected model", async () => {
    const { createHandler } = await import("../../extensions/commands/research.js");
    const notify = vi.fn();
    const handler = createHandler({ sendUserMessage } as never);

    await handler(
      "dopamine and motivation",
      makeCtx({ model: undefined, ui: { notify } }) as never,
    );

    expect(notify).toHaveBeenCalledWith(expect.stringContaining("No model selected"), "error");
  });

  it("should decompose via DECOMPOSITION_PROMPT then run the engine with all questions in one call", async () => {
    const { callLlmDirect } = await import("../../common/llm.js");
    const { runResearchEngine } = await import("../../extensions/research-engine/runner.js");
    const { writeBackToKB } = await import("../../extensions/research-engine/writeback.js");

    vi.mocked(callLlmDirect).mockImplementation((_m, _a, systemPrompt) => {
      if (systemPrompt.includes("WHY/HOW/WHAT")) {
        return Promise.resolve({ ok: true, value: QUESTION_TREE } as never);
      }
      return Promise.resolve({ ok: true, value: "Research report content." } as never);
    });
    vi.mocked(runResearchEngine).mockResolvedValue(RESEARCH_RESULT);
    vi.mocked(writeBackToKB).mockResolvedValue(WRITEBACK_RESULT);

    const { createHandler } = await import("../../extensions/commands/research.js");
    const handler = createHandler({ sendUserMessage } as never);
    const ctx = makeCtx();

    await handler("dopamine and motivation", ctx as never);

    // DECOMPOSITION_PROMPT invoked
    const decompPrompt = vi.mocked(callLlmDirect).mock.calls[0][2];
    expect(decompPrompt).toContain("WHY/HOW/WHAT");

    // Full question list fed to the engine in a single invocation
    expect(runResearchEngine).toHaveBeenCalledTimes(1);
    expect(runResearchEngine).toHaveBeenCalledWith(
      ["Why is X important?", "W1", "W2", "How does X work?", "H1"],
      ctx,
    );
    expect(writeBackToKB).toHaveBeenCalledTimes(1);

    // writeBackToKB runs before sendUserMessage; message has report + paths
    const writebackOrder = vi.mocked(writeBackToKB).mock.invocationCallOrder[0];
    const sendOrder = sendUserMessage.mock.invocationCallOrder[0];
    expect(writebackOrder).toBeLessThan(sendOrder);

    const message = sendUserMessage.mock.calls[0][0] as string;
    expect(message).toContain("Research report content.");
    expect(message).toContain("Resources/x-note.md");
  });

  it("should fall back to the topic when decomposition fails", async () => {
    const { callLlmDirect } = await import("../../common/llm.js");
    const { runResearchEngine } = await import("../../extensions/research-engine/runner.js");
    const { writeBackToKB } = await import("../../extensions/research-engine/writeback.js");

    vi.mocked(callLlmDirect).mockImplementation((_m, _a, systemPrompt) => {
      if (systemPrompt.includes("WHY/HOW/WHAT")) {
        return Promise.resolve({ ok: false, type: "error", message: "boom" } as never);
      }
      return Promise.resolve({ ok: true, value: "Fallback report." } as never);
    });
    vi.mocked(runResearchEngine).mockResolvedValue({
      ...RESEARCH_RESULT,
      questions: ["dopamine and motivation"],
    });
    vi.mocked(writeBackToKB).mockResolvedValue({ created: [], updated: [], skipped: [] });

    const { createHandler } = await import("../../extensions/commands/research.js");
    const handler = createHandler({ sendUserMessage } as never);

    await handler("dopamine and motivation", makeCtx() as never);

    expect(runResearchEngine).toHaveBeenCalledWith(["dopamine and motivation"], expect.anything());
    expect(sendUserMessage).toHaveBeenCalledWith(expect.stringContaining("Fallback report."));
  });

  it("should not send a message when the TUI custom result is null", async () => {
    const { createHandler } = await import("../../extensions/commands/research.js");
    const notify = vi.fn();
    const custom = vi.fn().mockResolvedValue(null);
    const handler = createHandler({ sendUserMessage } as never);

    await handler(
      "dopamine and motivation",
      makeCtx({ mode: "tui", ui: { notify, custom } }) as never,
    );

    expect(custom).toHaveBeenCalledTimes(1);
    expect(sendUserMessage).not.toHaveBeenCalled();
  });

  it("should register /research with description and handler", async () => {
    const mod = await import("../../extensions/commands/index.js");
    const registerCommand = vi.fn();
    const registerTool = vi.fn();
    mod.default({ registerCommand, registerTool, on: vi.fn() } as never);

    expect(registerCommand).toHaveBeenCalledWith(
      "research",
      expect.objectContaining({
        description: expect.any(String) as string,
        handler: expect.any(Function) as () => void,
      }),
    );
  });
});

describe("cleanup of old sufficiency modules (R9)", () => {
  it("should have deleted research-llm.ts from disk", () => {
    expect(existsSync(resolve(EXT_DIR, "commands/research-llm.ts"))).toBe(false);
  });

  it("should not import research-llm or its symbols anywhere under extensions/", () => {
    for (const file of collectTsFiles(EXT_DIR)) {
      const source = readFileSync(file, "utf-8");
      expect(source, file).not.toContain("research-llm");
      expect(source, file).not.toContain("SUFFICIENCY_PROMPT");
      expect(source, file).not.toContain("parseSufficiencyResponse");
    }
  });

  it("should keep DECOMPOSITION_PROMPT and drop formatResearchPlan from research-format.ts", async () => {
    const mod = (await import("../../extensions/commands/research-format.js")) as Record<
      string,
      unknown
    >;

    expect(mod.DECOMPOSITION_PROMPT).toBeDefined();
    expect(mod.DECOMPOSITION_PROMPT as string).toContain("WHY/HOW/WHAT");
    expect(mod.formatResearchPlan).toBeUndefined();
  });
});

describe("KNOWLEDGE_DIR tool descriptions (R10)", () => {
  it("should mention KNOWLEDGE_DIR and .env in create_para_doc description", () => {
    const source = readFileSync(resolve(EXT_DIR, "para-knowledge/tools/createDoc.ts"), "utf-8");
    expect(source).toContain("KNOWLEDGE_DIR");
    expect(source).toContain(".env");
  });

  it("should mention KNOWLEDGE_DIR and .env in batch_create_para_docs description", () => {
    const source = readFileSync(resolve(EXT_DIR, "batch-create/index.ts"), "utf-8");
    expect(source).toContain("KNOWLEDGE_DIR");
    expect(source).toContain(".env");
  });
});
