/**
 * Tests for the commands index module — verifies command and tool registration.
 *
 * @module tests/commands/index.test
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

type CommandConfig = {
  description: string;
  handler: (args: string, ctx: Record<string, unknown>) => Promise<void>;
};

describe("commands index", () => {
  let registerCommand: ReturnType<typeof vi.fn>;
  let registerTool: ReturnType<typeof vi.fn>;
  let sendUserMessage: ReturnType<typeof vi.fn>;
  let mockPi: Record<string, unknown>;

  beforeEach(() => {
    vi.resetModules();
    registerCommand = vi.fn();
    registerTool = vi.fn();
    sendUserMessage = vi.fn();
    mockPi = {
      registerCommand,
      registerTool,
      sendUserMessage,
    };
  });

  function getCommandConfig(name: string): [string, CommandConfig] | undefined {
    return registerCommand.mock.calls.find((c: unknown[]) => (c as string[])[0] === name) as
      | [string, CommandConfig]
      | undefined;
  }

  it("should register /ask command with description and handler", async () => {
    const mod = await import("../../extensions/commands/index.js");
    mod.default(mockPi as never);

    const call = getCommandConfig("ask");
    expect(call).toBeDefined();
    const [, config] = call!;
    expect(config).toHaveProperty("description");
    expect(typeof config.description).toBe("string");
    expect(config.description.length).toBeGreaterThan(0);
    expect(typeof config.handler).toBe("function");
  });

  it("should register /research command", async () => {
    const mod = await import("../../extensions/commands/index.js");
    mod.default(mockPi as never);

    const call = getCommandConfig("research");
    expect(call).toBeDefined();
    const [, config] = call!;
    expect(config).toHaveProperty("description");
    expect(typeof config.handler).toBe("function");
  });

  it("should register /summarize command", async () => {
    const mod = await import("../../extensions/commands/index.js");
    mod.default(mockPi as never);

    const call = getCommandConfig("summarize");
    expect(call).toBeDefined();
    const [, config] = call!;
    expect(config).toHaveProperty("description");
    expect(typeof config.handler).toBe("function");
  });

  it("should register exactly 3 commands", async () => {
    const mod = await import("../../extensions/commands/index.js");
    mod.default(mockPi as never);

    expect(registerCommand).toHaveBeenCalledTimes(3);
  });

  it("should register the ask tool", async () => {
    const mod = await import("../../extensions/commands/index.js");
    mod.default(mockPi as never);

    const toolCalls = (mockPi.registerTool as ReturnType<typeof vi.fn>).mock.calls;
    expect(toolCalls.length).toBe(1);
    const [toolDef] = toolCalls[0] as [Record<string, unknown>];
    expect(toolDef.name).toBe("ask");
    expect(toolDef.promptSnippet).toBeTruthy();
    expect(toolDef.promptGuidelines).toBeInstanceOf(Array);
  });

  it("should create /ask handler that works without TUI mode", async () => {
    const mod = await import("../../extensions/commands/index.js");
    mod.default(mockPi as never);

    const call = getCommandConfig("ask");
    expect(call).toBeDefined();
    const [, config] = call!;
    const handler = config.handler;

    const notify = vi.fn();
    const mockCtx = { ui: { notify }, cwd: "/test" };
    await handler("What is dopamine?", mockCtx);

    // Without TUI mode, the handler no longer errors about TUI requirement.
    // Instead it hits the model guard if no model is selected.
    expect(notify).not.toHaveBeenCalledWith(expect.stringContaining("requires interactive"));
    expect(sendUserMessage).not.toHaveBeenCalled();
  });
});
