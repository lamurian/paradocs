/**
 * Tests for the /ask command — research engine flow.
 *
 * @module tests/commands/ask.test
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
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
const ASK_TS = resolve(HERE, "../../extensions/commands/ask.ts");

const RESEARCH_RESULT = {
  sources: [{ url: "https://src.example/1", snippet: "Key point" }],
  questions: ["q1", "q2"],
  assessment: { sufficient: false, outdatedNotes: [], gaps: ["q1"] },
};

const WRITEBACK_RESULT = {
  created: ["Resources/new-note.md"],
  updated: ["Resources/old-note.md"],
  skipped: [],
};

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

describe("/ask command — research engine flow", () => {
  let sendUserMessage: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    sendUserMessage = vi.fn();
  });

  it("should show usage when no question is provided", async () => {
    const { createHandler } = await import("../../extensions/commands/ask.js");
    const notify = vi.fn();
    const handler = createHandler({ sendUserMessage } as never);

    await handler("", makeCtx({ ui: { notify } }) as never);

    expect(notify).toHaveBeenCalledWith(expect.stringContaining("Usage: /ask"), "warning");
    expect(sendUserMessage).not.toHaveBeenCalled();
  });

  it("should require a selected model", async () => {
    const { createHandler } = await import("../../extensions/commands/ask.js");
    const notify = vi.fn();
    const handler = createHandler({ sendUserMessage } as never);

    await handler("What is dopamine?", makeCtx({ model: undefined, ui: { notify } }) as never);

    expect(notify).toHaveBeenCalledWith(expect.stringContaining("No model selected"), "error");
    expect(sendUserMessage).not.toHaveBeenCalled();
  });

  it("should notify and stop when auth fails", async () => {
    const { createHandler } = await import("../../extensions/commands/ask.js");
    const notify = vi.fn();
    const handler = createHandler({ sendUserMessage } as never);

    await handler(
      "What is dopamine?",
      makeCtx({
        ui: { notify },
        modelRegistry: {
          getApiKeyAndHeaders: vi.fn().mockResolvedValue({ ok: false }),
        },
      }) as never,
    );

    expect(notify).toHaveBeenCalledWith(expect.stringContaining("API key"), "error");
    expect(sendUserMessage).not.toHaveBeenCalled();
  });

  it("should run reformulation, research engine, writeback, then synthesis in order", async () => {
    const { callLlmDirect } = await import("../../common/llm.js");
    const { runResearchEngine } = await import("../../extensions/research-engine/runner.js");
    const { writeBackToKB } = await import("../../extensions/research-engine/writeback.js");

    vi.mocked(callLlmDirect).mockImplementation((_m, _a, systemPrompt) => {
      if (systemPrompt.includes("Reformulate")) {
        return Promise.resolve({ ok: true, value: ["q1", "q2"] } as never);
      }
      return Promise.resolve({ ok: true, value: "Synthesized answer about dopamine." } as never);
    });
    vi.mocked(runResearchEngine).mockResolvedValue(RESEARCH_RESULT);
    vi.mocked(writeBackToKB).mockResolvedValue(WRITEBACK_RESULT);

    const { createHandler } = await import("../../extensions/commands/ask.js");
    const handler = createHandler({ sendUserMessage } as never);
    const ctx = makeCtx();

    await handler("What is dopamine?", ctx as never);

    expect(callLlmDirect).toHaveBeenCalledTimes(2);
    expect(runResearchEngine).toHaveBeenCalledWith(["q1", "q2"], ctx);
    expect(writeBackToKB).toHaveBeenCalledTimes(1);

    // Order: engine before writeback before synthesis before sendUserMessage
    const engineOrder = vi.mocked(runResearchEngine).mock.invocationCallOrder[0];
    const writebackOrder = vi.mocked(writeBackToKB).mock.invocationCallOrder[0];
    const synthesisOrder = vi.mocked(callLlmDirect).mock.invocationCallOrder[1];
    const sendOrder = sendUserMessage.mock.invocationCallOrder[0];
    expect(engineOrder).toBeLessThan(writebackOrder);
    expect(writebackOrder).toBeLessThan(synthesisOrder);
    expect(synthesisOrder).toBeLessThan(sendOrder);

    // Synthesis receives the collected sources
    const synthMessage = vi.mocked(callLlmDirect).mock.calls[1][3];
    const synthText = synthMessage.map((c: { text: string }) => c.text).join("\n");
    expect(synthText).toContain("https://src.example/1");

    // User message contains answer and note paths
    const message = sendUserMessage.mock.calls[0][0] as string;
    expect(message).toContain("Synthesized answer about dopamine.");
    expect(message).toContain("Resources/new-note.md");
    expect(message).toContain("Resources/old-note.md");
  });

  it("should fall back to the raw question when reformulation fails", async () => {
    const { callLlmDirect } = await import("../../common/llm.js");
    const { runResearchEngine } = await import("../../extensions/research-engine/runner.js");
    const { writeBackToKB } = await import("../../extensions/research-engine/writeback.js");

    vi.mocked(callLlmDirect).mockImplementation((_m, _a, systemPrompt) => {
      if (systemPrompt.includes("Reformulate")) {
        return Promise.resolve({ ok: false, type: "error", message: "boom" } as never);
      }
      return Promise.resolve({ ok: true, value: "Fallback answer." } as never);
    });
    vi.mocked(runResearchEngine).mockResolvedValue({
      ...RESEARCH_RESULT,
      questions: ["What is dopamine?"],
    });
    vi.mocked(writeBackToKB).mockResolvedValue({ created: [], updated: [], skipped: [] });

    const { createHandler } = await import("../../extensions/commands/ask.js");
    const handler = createHandler({ sendUserMessage } as never);

    await handler("What is dopamine?", makeCtx() as never);

    expect(runResearchEngine).toHaveBeenCalledWith(["What is dopamine?"], expect.anything());
    expect(sendUserMessage).toHaveBeenCalledWith(expect.stringContaining("Fallback answer."));
  });

  it("should not send a message when the TUI custom result is null", async () => {
    const { createHandler } = await import("../../extensions/commands/ask.js");
    const notify = vi.fn();
    const custom = vi.fn().mockResolvedValue(null);
    const handler = createHandler({ sendUserMessage } as never);

    await handler("What is dopamine?", makeCtx({ mode: "tui", ui: { notify, custom } }) as never);

    expect(custom).toHaveBeenCalledTimes(1);
    expect(sendUserMessage).not.toHaveBeenCalled();
  });

  it("should not reference the removed runAskSufficiency path", () => {
    const source = readFileSync(ASK_TS, "utf-8");
    expect(source).not.toContain("runAskSufficiency");
    expect(source).not.toContain("SufficiencyResult");
  });
});
