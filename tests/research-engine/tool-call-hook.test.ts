/**
 * Tests for the research engine tool_call hook — deterministic KB-first enforcement.
 *
 * @module tests/research-engine/tool-call-hook.test
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

type HookHandler = (
  event: { toolName: string },
  ctx: { sessionManager: { getEntries: () => unknown[] } },
) => { block: boolean; reason: string } | undefined;

const BLOCKED_TOOLS = ["web_search", "fetch_url", "batch_extract_failed"];

describe("research engine tool_call hook", () => {
  let handlers: Map<string, HookHandler>;

  beforeEach(async () => {
    vi.resetModules();
    handlers = new Map();
    const mod = await import("../../extensions/research-engine/index.js");
    mod.default({
      registerTool: vi.fn(),
      on: (event: string, handler: HookHandler) => {
        handlers.set(event, handler);
      },
    } as never);
  });

  afterEach(() => {
    delete process.env.PI_RESEARCH_ENGINE;
  });

  function getHook(): HookHandler {
    const hook = handlers.get("tool_call");
    expect(hook).toBeDefined();
    return hook as HookHandler;
  }

  function makeCtx(entries: unknown[]): { sessionManager: { getEntries: () => unknown[] } } {
    return { sessionManager: { getEntries: () => entries } };
  }

  it("should block web tools before search_para_docs when env is set", () => {
    process.env.PI_RESEARCH_ENGINE = "1";
    const hook = getHook();

    for (const tool of BLOCKED_TOOLS) {
      const res = hook({ toolName: tool }, makeCtx([]));
      expect(res).toBeDefined();
      expect(res?.block).toBe(true);
      expect(res?.reason).toContain("search_para_docs");
    }
  });

  it("should allow web tools after a search_para_docs tool result exists", () => {
    process.env.PI_RESEARCH_ENGINE = "1";
    const hook = getHook();
    const entries = [
      { type: "message", message: { role: "toolResult", toolName: "search_para_docs" } },
    ];

    for (const tool of BLOCKED_TOOLS) {
      expect(hook({ toolName: tool }, makeCtx(entries))).toBeUndefined();
    }
  });

  it("should never block when the env var is absent (main agent unaffected)", () => {
    delete process.env.PI_RESEARCH_ENGINE;
    const hook = getHook();

    for (const tool of [...BLOCKED_TOOLS, "search_para_docs", "read", "bash"]) {
      expect(hook({ toolName: tool }, makeCtx([]))).toBeUndefined();
    }
  });

  it("should not block non-web tools inside research subagents", () => {
    process.env.PI_RESEARCH_ENGINE = "1";
    const hook = getHook();

    for (const tool of ["search_para_docs", "resolve_citation", "read"]) {
      expect(hook({ toolName: tool }, makeCtx([]))).toBeUndefined();
    }
  });

  it("should not treat a non-toolResult search_para_docs entry as KB search", () => {
    process.env.PI_RESEARCH_ENGINE = "1";
    const hook = getHook();
    const entries = [
      { type: "message", message: { role: "assistant", toolName: "search_para_docs" } },
    ];

    const res = hook({ toolName: "web_search" }, makeCtx(entries));
    expect(res?.block).toBe(true);
  });
});
