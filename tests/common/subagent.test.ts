/**
 * Tests for common/subagent.ts — pi subprocess transport (T2).
 *
 * Verifies JSONL parsing (last assistant message wins), structured errors
 * carrying the real cause (stderr, exit code, "no assistant output",
 * raw-text snippet on parse failure), and the timeout kill path.
 */

import { describe, it, expect } from "vitest";

import { fakeSpawn, TWO_EVENTS } from "./helpers/fake-subagent.js";
import {
  buildSubagentArgs,
  extractFinalAssistantText,
  getPiInvocation,
  resolveSubagentTimeoutMs,
  runSubagent,
} from "../../common/subagent.js";

// ── buildSubagentArgs ─────────────────────────────────────────────────

describe("buildSubagentArgs", () => {
  it("produces the base lean CLI with literal prompt text and Task suffix", () => {
    const args = buildSubagentArgs({
      provider: "opencode-go",
      modelId: "mimo-v2.5",
      systemPrompt: "You are terse.",
      task: "summarize https://x",
    });
    expect(args).toEqual([
      "--mode",
      "json",
      "-p",
      "--no-session",
      "--no-extensions",
      "--offline",
      "--thinking",
      "minimal",
      "--no-context-files",
      "--no-skills",
      "--provider",
      "opencode-go",
      "--model",
      "mimo-v2.5",
      "--append-system-prompt",
      "You are terse.",
      "Task: summarize https://x",
    ]);
  });

  it("inserts extra args (e.g. -e/--tools) after --no-extensions", () => {
    const args = buildSubagentArgs({
      provider: "p",
      modelId: "m",
      systemPrompt: "s",
      task: "t",
      extraArgs: ["-e", "/pkg/extensions/web-search", "--tools", "web_search"],
    });
    const noExt = args.indexOf("--no-extensions");
    expect(args.slice(noExt + 1, noExt + 5)).toEqual([
      "-e",
      "/pkg/extensions/web-search",
      "--tools",
      "web_search",
    ]);
    expect(args[args.length - 1]).toBe("Task: t");
  });
});

// ── getPiInvocation ───────────────────────────────────────────────────

describe("getPiInvocation", () => {
  it("honors PI_BIN override", () => {
    const prev = process.env.PI_BIN;
    process.env.PI_BIN = "/custom/pi";
    try {
      expect(getPiInvocation(["--version"])).toEqual({
        command: "/custom/pi",
        args: ["--version"],
      });
    } finally {
      if (prev === undefined) delete process.env.PI_BIN;
      else process.env.PI_BIN = prev;
    }
  });
});

// ── extractFinalAssistantText ─────────────────────────────────────────

describe("extractFinalAssistantText", () => {
  it("returns the text of the LAST assistant message_end event", () => {
    const events = TWO_EVENTS.split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l) as Record<string, unknown>);
    expect(extractFinalAssistantText(events)).toBe("second answer");
  });

  it("joins multiple text parts of one message", () => {
    const events = [
      {
        type: "message_end",
        message: {
          role: "assistant",
          content: [
            { type: "text", text: "a" },
            { type: "text", text: "b" },
          ],
        },
      },
    ];
    expect(extractFinalAssistantText(events)).toBe("a\nb");
  });

  it("returns empty string when no assistant text exists", () => {
    expect(extractFinalAssistantText([{ type: "message_end", message: { role: "user" } }])).toBe(
      "",
    );
  });
});

// ── resolveSubagentTimeoutMs ──────────────────────────────────────────

describe("resolveSubagentTimeoutMs", () => {
  it("prefers explicit override, then role env, then global env, then default", () => {
    const prevRole = process.env.PI_SUBAGENT_TIMEOUT_MS_SUMMARIZE;
    const prevGlobal = process.env.PI_SUBAGENT_TIMEOUT_MS;
    try {
      expect(resolveSubagentTimeoutMs("summarize", 5_000)).toBe(5_000);
      delete process.env.PI_SUBAGENT_TIMEOUT_MS_SUMMARIZE;
      delete process.env.PI_SUBAGENT_TIMEOUT_MS;
      expect(resolveSubagentTimeoutMs("summarize")).toBe(60_000);
      expect(resolveSubagentTimeoutMs("search")).toBe(120_000);
      process.env.PI_SUBAGENT_TIMEOUT_MS = "9000";
      expect(resolveSubagentTimeoutMs("summarize")).toBe(9_000);
      process.env.PI_SUBAGENT_TIMEOUT_MS_SUMMARIZE = "7000";
      expect(resolveSubagentTimeoutMs("summarize")).toBe(7_000);
    } finally {
      if (prevRole === undefined) delete process.env.PI_SUBAGENT_TIMEOUT_MS_SUMMARIZE;
      else process.env.PI_SUBAGENT_TIMEOUT_MS_SUMMARIZE = prevRole;
      if (prevGlobal === undefined) delete process.env.PI_SUBAGENT_TIMEOUT_MS;
      else process.env.PI_SUBAGENT_TIMEOUT_MS = prevGlobal;
    }
  });
});

// ── runSubagent ───────────────────────────────────────────────────────

describe("runSubagent", () => {
  const baseArgs = ["--mode", "json", "-p"];

  it("returns the last assistant text on success", async () => {
    const res = await runSubagent({
      args: baseArgs,
      timeoutMs: 2_000,
      spawnImpl: fakeSpawn({ stdout: TWO_EVENTS }),
    });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.text).toBe("second answer");
  });

  it("carries stderr in the error when the process exits non-zero without text", async () => {
    const res = await runSubagent({
      args: baseArgs,
      timeoutMs: 2_000,
      spawnImpl: fakeSpawn({ stderr: "boom", exitCode: 1 }),
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain("boom");
  });

  it("reports 'no assistant output' when the process succeeds with no assistant text", async () => {
    const res = await runSubagent({
      args: baseArgs,
      timeoutMs: 2_000,
      spawnImpl: fakeSpawn({ stdout: '{"type":"message_end","message":{"role":"user"}}\n' }),
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain("no assistant output");
  });

  it("includes the first 200 chars of raw text when parsing fails", async () => {
    const raw = "R".repeat(250);
    const stdout = JSON.stringify({
      type: "message_end",
      message: { role: "assistant", content: [{ type: "text", text: raw }] },
    });
    const res = await runSubagent({
      args: baseArgs,
      timeoutMs: 2_000,
      parse: () => null,
      spawnImpl: fakeSpawn({ stdout }),
    });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toContain("R".repeat(200));
      expect(res.error).not.toContain("R".repeat(201));
    }
  });

  it("applies a parse function to the extracted text", async () => {
    const res = await runSubagent<{ v: number }>({
      args: baseArgs,
      timeoutMs: 2_000,
      parse: (text) => ({ v: text.length }),
      spawnImpl: fakeSpawn({ stdout: TWO_EVENTS }),
    });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.value).toEqual({ v: "second answer".length });
  });

  it("kills the process on timeout and returns a timeout error", async () => {
    const spawn = fakeSpawn({ hang: true });
    const res = await runSubagent({
      args: baseArgs,
      timeoutMs: 50,
      spawnImpl: spawn,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain("timed out after 50ms");
    expect(spawn.procs).toHaveLength(1);
    expect(spawn.procs[0].killCalls).toEqual(["SIGKILL"]);
  });

  it("surfaces spawn errors (e.g. ENOENT) as the error message", async () => {
    const res = await runSubagent({
      args: baseArgs,
      timeoutMs: 2_000,
      spawnImpl: fakeSpawn({ spawnError: new Error("ENOENT: pi not found") }),
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain("ENOENT");
  });

  it("returns 'subagent aborted' for an already-aborted signal", async () => {
    const controller = new AbortController();
    controller.abort();
    const spawn = fakeSpawn({ hang: true });
    const res = await runSubagent({
      args: baseArgs,
      timeoutMs: 2_000,
      signal: controller.signal,
      spawnImpl: spawn,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe("subagent aborted");
    expect(spawn.procs[0].killCalls).toEqual(["SIGKILL"]);
  });

  it("kills the process and reports abort when the signal fires mid-run", async () => {
    const controller = new AbortController();
    const spawn = fakeSpawn({ hang: true });
    const promise = runSubagent({
      args: baseArgs,
      timeoutMs: 2_000,
      signal: controller.signal,
      spawnImpl: spawn,
    });
    controller.abort();
    const res = await promise;
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe("subagent aborted");
    expect(spawn.procs[0].killCalls).toContain("SIGKILL");
  });
});
