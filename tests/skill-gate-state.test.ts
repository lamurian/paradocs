/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Gate state machine tests ──────────────────────────────────────────────

describe("gate state transitions", () => {
  type HandlerMap = Map<string, Array<(event: unknown, ctx: unknown) => unknown>>;

  let handlers: HandlerMap;
  let notify: ReturnType<typeof vi.fn>;
  let mockPi: Record<string, unknown>;
  let mockCtx: Record<string, unknown>;

  beforeEach(() => {
    vi.resetModules();
    handlers = new Map();
    notify = vi.fn();
    mockCtx = {
      hasUI: true,
      ui: { notify },
      cwd: "/test",
    };
    mockPi = {
      on: vi.fn((event: string, handler: (event: unknown, ctx: unknown) => unknown) => {
        if (!handlers.has(event)) handlers.set(event, []);
        handlers.get(event)!.push(handler);
      }),
      registerCommand: vi.fn(),
    };
  });

  function fireEvent(event: string, eventData: unknown): void {
    const hs = handlers.get(event);
    if (hs) {
      for (const h of hs) {
        h(eventData, mockCtx);
      }
    }
  }

  function importAndInit(): Promise<void> {
    return import("../extensions/skill-gate.js").then((mod) => {
      mod.default(mockPi as never);
    });
  }

  it("should reset turn state on turn_start", async () => {
    await importAndInit();
    fireEvent("tool_execution_start", {
      type: "tool_execution_start",
      toolCallId: "call-1",
      toolName: "search_para_docs",
      args: { query: "test" },
    });
    fireEvent("turn_start", {
      type: "turn_start",
      turnIndex: 2,
      timestamp: Date.now(),
    });
    fireEvent("tool_call", {
      type: "tool_call",
      toolCallId: "call-2",
      toolName: "write",
      input: { path: "Projects/test.md" },
    });
    expect(notify).toHaveBeenCalledWith(
      expect.stringContaining("Writing to PARA dir without search"),
      "warning",
    );
  });

  it("should track tool_execution_start for search_para_docs", async () => {
    await importAndInit();
    fireEvent("tool_execution_start", {
      type: "tool_execution_start",
      toolCallId: "call-1",
      toolName: "search_para_docs",
      args: { query: "test" },
    });
    fireEvent("tool_call", {
      type: "tool_call",
      toolCallId: "call-2",
      toolName: "write",
      input: { path: "Projects/test.md" },
    });
    expect(notify).not.toHaveBeenCalled();
  });

  it("should track search result count from tool_result", async () => {
    await importAndInit();
    fireEvent("tool_execution_start", {
      type: "tool_execution_start",
      toolCallId: "call-1",
      toolName: "search_para_docs",
      args: { query: "test" },
    });
    fireEvent("tool_result", {
      type: "tool_result",
      toolCallId: "call-1",
      toolName: "search_para_docs",
      input: {},
      content: [
        {
          type: "text",
          text: "- [Doc 1](Projects/doc1.md)\n- [Doc 2](Projects/doc2.md)\n- [Doc 3](Resources/doc3.md)",
        },
      ],
      isError: false,
    });
    fireEvent("tool_call", {
      type: "tool_call",
      toolCallId: "call-2",
      toolName: "create_para_doc",
      input: {},
    });
    expect(notify).toHaveBeenCalledWith(expect.stringContaining("found 3 existing doc"), "warning");
  });

  it("should warn when editing PARA file without reading it first", async () => {
    await importAndInit();
    fireEvent("tool_call", {
      type: "tool_call",
      toolCallId: "call-1",
      toolName: "edit",
      input: { path: "Projects/test.md" },
    });
    expect(notify).toHaveBeenCalledWith(
      expect.stringContaining('Editing "Projects/test.md" without reading'),
      "warning",
    );
  });

  it("should not warn when editing PARA file after reading it", async () => {
    await importAndInit();
    fireEvent("tool_call", {
      type: "tool_call",
      toolCallId: "call-1",
      toolName: "read",
      input: { path: "Projects/test.md" },
    });
    fireEvent("tool_call", {
      type: "tool_call",
      toolCallId: "call-2",
      toolName: "edit",
      input: { path: "Projects/test.md" },
    });
    expect(notify).not.toHaveBeenCalled();
  });

  it("should warn when update_para_doc called without reading first", async () => {
    await importAndInit();
    fireEvent("tool_call", {
      type: "tool_call",
      toolCallId: "call-1",
      toolName: "update_para_doc",
      input: { path: "Projects/test.md" },
    });
    expect(notify).toHaveBeenCalledWith(
      expect.stringContaining('Updating "Projects/test.md" without reading'),
      "warning",
    );
  });

  it("should bypass gate when session.bypassed is set via /bypass-gate command", async () => {
    await importAndInit();
    const registerCommandCalls = (mockPi.registerCommand as ReturnType<typeof vi.fn>).mock.calls;
    const bypassCmd = registerCommandCalls.find((c: string[]) => c[0] === "bypass-gate");
    if (bypassCmd) {
      const handler = bypassCmd[1].handler;
      await handler([], mockCtx);
    }
    fireEvent("tool_call", {
      type: "tool_call",
      toolCallId: "call-1",
      toolName: "write",
      input: { path: "Projects/test.md" },
    });
    expect(notify).toHaveBeenCalledWith("Skill gates suspended for this session.", "info");
  });

  it("should handle session_start lifecycle", async () => {
    await importAndInit();
    fireEvent("tool_execution_start", {
      type: "tool_execution_start",
      toolCallId: "call-1",
      toolName: "search_para_docs",
      args: { query: "test" },
    });
    fireEvent("session_start", { type: "session_start", reason: "new" });
    fireEvent("tool_call", {
      type: "tool_call",
      toolCallId: "call-2",
      toolName: "write",
      input: { path: "Projects/reset-test.md" },
    });
    expect(notify).toHaveBeenCalledWith(
      expect.stringContaining("Writing to PARA dir without search"),
      "warning",
    );
  });

  it("should handle create_para_doc when search returned 0 results", async () => {
    await importAndInit();
    fireEvent("tool_execution_start", {
      type: "tool_execution_start",
      toolCallId: "call-1",
      toolName: "search_para_docs",
      args: { query: "new-topic" },
    });
    fireEvent("tool_result", {
      type: "tool_result",
      toolCallId: "call-1",
      toolName: "search_para_docs",
      input: {},
      content: [{ type: "text", text: "No results found." }],
      isError: false,
    });
    fireEvent("tool_call", {
      type: "tool_call",
      toolCallId: "call-2",
      toolName: "create_para_doc",
      input: {},
    });
    expect(notify).toHaveBeenCalledWith(
      expect.stringContaining("No existing docs found"),
      "warning",
    );
  });

  it("should handle batch_create_para_docs gate", async () => {
    await importAndInit();
    fireEvent("tool_call", {
      type: "tool_call",
      toolCallId: "call-1",
      toolName: "batch_create_para_docs",
      input: {},
    });
    expect(notify).toHaveBeenCalledWith(
      expect.stringContaining("Creating document without search"),
      "warning",
    );
  });
});
