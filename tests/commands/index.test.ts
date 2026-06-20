/**
 * Tests for the commands index module — verifies command registration.
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
  let sendUserMessage: ReturnType<typeof vi.fn>;
  let mockPi: Record<string, unknown>;

  beforeEach(() => {
    vi.resetModules();
    registerCommand = vi.fn();
    sendUserMessage = vi.fn();
    mockPi = {
      registerCommand,
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

  it("should create /ask handler that captures pi.sendUserMessage", async () => {
    const mod = await import("../../extensions/commands/index.js");
    mod.default(mockPi as never);

    const call = getCommandConfig("ask");
    expect(call).toBeDefined();
    const [, config] = call!;
    const handler = config.handler;

    const mockCtx = { ui: { notify: vi.fn() }, cwd: "/test" };
    await handler("What is dopamine?", mockCtx);

    expect(sendUserMessage).toHaveBeenCalledTimes(1);
    const prompt = sendUserMessage.mock.calls[0][0] as string;
    expect(prompt).toContain("QUESTION: What is dopamine?");
  });
});
