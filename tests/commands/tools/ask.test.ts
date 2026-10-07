/**
 * Tests for the ask tool — quick/deep modes, escalation UX, digest (T14),
 * progress streaming via onUpdate (T3).
 *
 * Fixtures and harness live in helpers/ask-tool-fixtures.ts.
 *
 * @module tests/commands/tools/ask.test
 */

import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname, resolve as pathResolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../../extensions/research-engine/orchestrator.js", () => ({
  runResearch: vi.fn(),
  DEFAULT_STAGE_MESSAGES: {},
}));
vi.mock("../../../extensions/research-engine/deps.js", () => ({
  buildResearchDeps: vi.fn(() => ({})),
}));

import {
  baseState,
  ESCALATED,
  DEEP_DONE,
  runAskTool,
  importTool,
} from "./helpers/ask-tool-fixtures.js";

import type { ToolUpdate } from "./helpers/ask-tool-fixtures.js";
import type { ResearchState } from "../../../extensions/research-engine/state.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const ASK_TOOL_TS = pathResolve(HERE, "../../../extensions/commands/tools/ask.ts");

let kbDir: string;
const dirs: string[] = [];

beforeEach(() => {
  kbDir = mkdtempSync(join(homedir(), "ask-tool-test-"));
  dirs.push(kbDir);
  process.env.KNOWLEDGE_DIR = kbDir;
  process.env.KNOWLEDGE_DB = "notes.db";
});

afterEach(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  dirs.length = 0;
  delete process.env.KNOWLEDGE_DIR;
  delete process.env.KNOWLEDGE_DB;
});

describe("ask tool — quick/deep modes (T14)", () => {
  it("should register with KNOWLEDGE_DIR in description and guidelines", async () => {
    const pi = { sendUserMessage: vi.fn() };
    const { tool } = await importTool(pi);
    expect(tool.name).toBe("ask");
    const description = tool.description as string;
    const guidelines = (tool.promptGuidelines as string[]).join("\n");
    expect(description).toContain("KNOWLEDGE_DIR");
    expect(guidelines).toContain("KNOWLEDGE_DIR");
    expect(guidelines).toContain(".env");
  });

  it("quick: apply the quick profile, render answer + digest + state path", async () => {
    const pi = { sendUserMessage: vi.fn() };
    const { tool, runResearch, buildResearchDeps } = await importTool(pi);
    runResearch.mockResolvedValue(baseState());

    const result = await runAskTool(tool, { question: "what is x" });

    expect(buildResearchDeps).toHaveBeenCalledWith(expect.anything(), expect.anything(), {
      allowEscalation: true,
    });
    expect(runResearch).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        question: "what is x",
        profile: expect.objectContaining({
          name: "ask-quick",
          targetSources: 5,
          maxCycles: 1,
          deadlineMs: 90_000,
        }) as Record<string, unknown>,
      }),
    );
    const text = result.content[0].text;
    expect(text).toContain("Quick answer.");
    expect(text).toContain("Digest:");
    expect(text).toContain("sources: 5");
    expect(text).toContain("cycle1: [q1]");
    expect(text).toContain(`State: ${join(kbDir, ".research")}`);
    expect(result.details.digest).toMatchObject({ sourceCount: 5 });
  });

  it("quick: escalate with session-visible line + job handle, deep job seeded (T14)", async () => {
    const pi = { sendUserMessage: vi.fn() };
    const { tool, runResearch } = await importTool(pi);
    runResearch.mockResolvedValueOnce(ESCALATED).mockResolvedValueOnce(DEEP_DONE);

    const result = await runAskTool(tool, { question: "what is x" });
    const text = result.content[0].text;
    expect(text).toContain("escalated to deep research: THIN_CANDIDATES (6<8 candidates)");
    expect(text).toMatch(/\(job ask-esc-deep\)|\(job [^)]+\)/);
    expect(result.details.deepJobId).toBeDefined();

    const secondCall = runResearch.mock.calls[1][1] as Record<string, unknown>;
    expect(secondCall.mode).toBe("depth");
    expect(secondCall.profile).toMatchObject({ name: "ask-deep", targetSources: 10, maxCycles: 3 });
    expect(secondCall.seed).toMatchObject({
      visited: ["https://a.com/0"],
      askedQuestions: ["old q"],
    });
    expect((secondCall.seed as { summaries: unknown[] }).summaries).toHaveLength(2);

    await vi.waitFor(() => expect(pi.sendUserMessage).toHaveBeenCalledTimes(1));
    const delivered = pi.sendUserMessage.mock.calls[0];
    expect(delivered[0]).toContain("Deep research finished");
    expect(delivered[0]).toContain("Deep answer.");
    expect(delivered[1]).toEqual({ deliverAs: "followUp" });
  });

  it("deep: return a handle immediately and deliver via followUp", async () => {
    const pi = { sendUserMessage: vi.fn() };
    const { tool, runResearch } = await importTool(pi);
    let resolveRun: (s: ResearchState) => void = () => {};
    runResearch.mockReturnValue(
      new Promise<ResearchState>((r) => {
        resolveRun = r;
      }),
    );

    const started = Date.now();
    const result = await runAskTool(tool, { question: "broad topic", mode: "deep" });
    const elapsed = Date.now() - started;

    expect(elapsed).toBeLessThan(500);
    expect(result.content[0].text).toContain("Deep research started (job");
    expect(result.details.mode).toBe("deep");
    expect(runResearch).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        profile: expect.objectContaining({ name: "ask-deep" }) as Record<string, unknown>,
      }),
    );

    resolveRun(DEEP_DONE);
    await vi.waitFor(() => expect(pi.sendUserMessage).toHaveBeenCalledTimes(1));
    const delivered = pi.sendUserMessage.mock.calls[0];
    expect(delivered[0]).toContain("Deep research finished");
    expect(delivered[1]).toEqual({ deliverAs: "followUp" });
  });

  it("quick: streams stage/detail progress via onUpdate before the final result (T3)", async () => {
    const pi = { sendUserMessage: vi.fn() };
    const { tool, runResearch } = await importTool(pi);
    runResearch.mockImplementation(((deps: {
      onProgress?: (stage: string, message: string) => void;
      onDetail?: (message: string) => void;
    }) => {
      deps.onProgress?.("FETCH", "fetching…");
      deps.onDetail?.("fetched 2/5");
      deps.onProgress?.("SYNTHESIZE", "synthesizing…");
      return Promise.resolve(baseState());
    }) as never);

    const updates: ToolUpdate[] = [];
    const result = await runAskTool(tool, { question: "what is x" }, (u) => updates.push(u));

    expect(updates.length).toBeGreaterThanOrEqual(4);
    expect(updates[0].content[0].text).toContain("Researching knowledge base and web…");
    expect(
      updates.some((u) => u.content[0].text === "fetching…" && u.details.stage === "FETCH"),
    ).toBe(true);
    expect(updates.some((u) => u.content[0].text === "fetched 2/5")).toBe(true);
    expect(
      updates.some(
        (u) => u.content[0].text === "synthesizing…" && u.details.stage === "SYNTHESIZE",
      ),
    ).toBe(true);

    // Final rendering unchanged: answer + digest + state path.
    const text = result.content[0].text;
    expect(text).toContain("Quick answer.");
    expect(text).toContain("Digest:");
    expect(text).toContain("sources: 5");
    expect(text).toContain(`State: ${join(kbDir, ".research")}`);
    expect(result.details.digest).toMatchObject({ sourceCount: 5 });
  });

  it("deep: stays silent beyond the startup update (T3)", async () => {
    const pi = { sendUserMessage: vi.fn() };
    const { tool, runResearch } = await importTool(pi);
    let resolveRun: (s: ResearchState) => void = () => {};
    runResearch.mockReturnValue(
      new Promise<ResearchState>((r) => {
        resolveRun = r;
      }),
    );

    const updates: ToolUpdate[] = [];
    const result = await runAskTool(tool, { question: "broad topic", mode: "deep" }, (u) =>
      updates.push(u),
    );

    expect(result.details.mode).toBe("deep");
    expect(updates).toHaveLength(1);
    expect(updates[0].content[0].text).toContain("Researching knowledge base and web…");
    const depsArg = runResearch.mock.calls[0][0] as Record<string, unknown>;
    expect(depsArg.onProgress).toBeUndefined();
    expect(depsArg.onDetail).toBeUndefined();

    resolveRun(DEEP_DONE);
    await vi.waitFor(() => expect(pi.sendUserMessage).toHaveBeenCalledTimes(1));
  });

  it("should seed avoidQuestions/knownSources from the digest params", async () => {
    const pi = { sendUserMessage: vi.fn() };
    const { tool, runResearch } = await importTool(pi);
    runResearch.mockResolvedValue(baseState());

    await runAskTool(tool, {
      question: "follow-up",
      avoidQuestions: ["q1"],
      knownSources: ["https://a.com/0"],
    });

    const call = runResearch.mock.calls[0][1] as {
      seed: { askedQuestions: string[]; visited: string[] };
    };
    expect(call.seed.askedQuestions).toEqual(["q1"]);
    expect(call.seed.visited).toEqual(["https://a.com/0"]);
  });

  it("should return a notice without researching when no question is given", async () => {
    const pi = { sendUserMessage: vi.fn() };
    const { tool, runResearch } = await importTool(pi);
    const result = await runAskTool(tool, { question: "   " });
    expect(result.content[0].text).toContain("No question provided");
    expect(runResearch).not.toHaveBeenCalled();
  });

  it("should have no direct searchDocs calls in the tool source", () => {
    const source = readFileSync(ASK_TOOL_TS, "utf-8");
    expect(source).not.toContain("searchDocs");
    expect(source).not.toContain("runResearchEngine");
  });
});
