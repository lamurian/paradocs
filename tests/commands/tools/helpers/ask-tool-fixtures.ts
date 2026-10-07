/**
 * Shared fixtures and harness for the ask tool tests (T3/T14).
 *
 * Provides research-state fixtures, the tool execution harness, and the
 * register-import helper used by tests/commands/tools/ask.test.ts. Keeps the
 * declared test file under the repo's 300-line limit without touching any
 * assertion.
 *
 * @module tests/commands/tools/helpers/ask-tool-fixtures
 */

import { vi } from "vitest";

import {
  ASK_QUICK_PROFILE,
  ASK_DEEP_PROFILE,
} from "../../../../extensions/research-engine/profiles.js";

import type { ResearchState } from "../../../../extensions/research-engine/state.js";

/** Tool-execution update shape captured from the ask tool's onUpdate. */
export interface ToolUpdate {
  content: Array<{ type: string; text: string }>;
  details: Record<string, unknown>;
}

/** Final result shape returned by ask.execute. */
export interface ToolResult {
  content: Array<{ type: string; text: string }>;
  details: Record<string, unknown>;
}

/**
 * Build a quick-mode DONE_SUFFICIENT research state (5 sources, digest data).
 *
 * @param overrides - Field overrides merged over the defaults.
 * @returns A complete ResearchState.
 */
export function baseState(overrides: Partial<ResearchState> = {}): ResearchState {
  return {
    jobId: "ask-x",
    question: "what is x",
    mode: "breadth",
    profile: ASK_QUICK_PROFILE,
    stage: "DONE_SUFFICIENT",
    cycle: 1,
    startedAt: 0,
    deadlineAt: 1,
    queries: ["q1"],
    summaries: Array.from({ length: 5 }, (_, i) => ({
      url: `https://a.com/${i}`,
      canonicalUrl: `https://a.com/${i}`,
      summary: `summary ${i}`,
    })),
    visited: ["https://a.com/0"],
    askedQuestions: ["q1"],
    gaps: [],
    cycles: [{ cycle: 1, questions: ["q1"], candidates: 10, fetched: 5, summarized: 5 }],
    failures: [],
    synthesis: "Quick answer.",
    writeback: { created: ["Resources/n.md"], updated: [], skipped: [] },
    ...overrides,
  } as ResearchState;
}

/** Escalated state that triggers the deep-job seed path (T14). */
export const ESCALATED: ResearchState = baseState({
  jobId: "ask-esc",
  stage: "ESCALATED",
  summaries: [
    { url: "https://a.com/0", canonicalUrl: "https://a.com/0", summary: "s0" },
    { url: "https://a.com/1", canonicalUrl: "https://a.com/1", summary: "s1" },
  ],
  lastRankCount: 6,
  synthesis: undefined,
  gaps: ["more sources"],
  cycles: [{ cycle: 1, questions: ["old q"], candidates: 6, fetched: 6, summarized: 2 }],
  askedQuestions: ["old q"],
  visited: ["https://a.com/0"],
  escalation: {
    from: "ASSESS",
    escalate: true,
    reason: "THIN_CANDIDATES (6<8 candidates)",
    guards: { lastRankCount: 6 },
  },
});

/** Terminal deep-job state used for followUp delivery assertions. */
export const DEEP_DONE: ResearchState = baseState({
  jobId: "ask-esc-deep",
  profile: ASK_DEEP_PROFILE,
  synthesis: "Deep answer.",
  summaries: [{ url: "https://deep.com/1", canonicalUrl: "https://deep.com/1", summary: "d1" }],
});

/**
 * Build a minimal rpc-mode pi extension context for the ask tool.
 *
 * @returns Context object accepted by ask.execute.
 */
export function makeToolCtx(): Record<string, unknown> {
  return {
    cwd: "/test",
    mode: "rpc",
    model: { id: "m", provider: "p" },
    modelRegistry: {
      getApiKeyAndHeaders: vi.fn().mockResolvedValue({ ok: true, apiKey: "sk-test" }),
    },
  };
}

/**
 * Invoke the registered ask tool's execute with a fresh rpc-mode context.
 *
 * @param tool - The registered tool object (from registerTool mock calls).
 * @param params - Tool parameters.
 * @param onUpdate - Optional update collector for tool-execution updates.
 * @returns The tool result.
 */
export async function runAskTool(
  tool: Record<string, unknown>,
  params: Record<string, unknown>,
  onUpdate?: (update: ToolUpdate) => void,
): Promise<ToolResult> {
  const fn = tool.execute as (
    id: string,
    p: Record<string, unknown>,
    sig: undefined,
    up: ((update: ToolUpdate) => void) | undefined,
    ctx: Record<string, unknown>,
  ) => Promise<ToolResult>;
  return fn("call", params, undefined, onUpdate, makeToolCtx());
}

/**
 * Reset the module registry, import the ask tool with mocks applied, and
 * return the test harness.
 *
 * @param pi - Partial pi API with a sendUserMessage spy.
 * @returns Registered tool, mocked runResearch, and mocked buildResearchDeps.
 */
export async function importTool(pi: { sendUserMessage: ReturnType<typeof vi.fn> }): Promise<{
  tool: Record<string, unknown>;
  runResearch: ReturnType<typeof vi.fn>;
  buildResearchDeps: ReturnType<typeof vi.fn>;
}> {
  vi.resetModules();
  const { registerAskTool } = await import("../../../../extensions/commands/tools/ask.js");
  const orch = await import("../../../../extensions/research-engine/orchestrator.js");
  const deps = await import("../../../../extensions/research-engine/deps.js");
  vi.clearAllMocks();
  const registerTool = vi.fn();
  registerAskTool({ registerTool, on: vi.fn(), ...pi } as never);
  return {
    tool: registerTool.mock.calls[0][0] as Record<string, unknown>,
    runResearch: vi.mocked(orch.runResearch),
    buildResearchDeps: vi.mocked(deps.buildResearchDeps),
  };
}
