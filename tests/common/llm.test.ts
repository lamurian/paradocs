/**
 * Tests for common/llm.ts — callLlmDirect incl. timeoutMs support.
 *
 * @module tests/common/llm.test
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@earendil-works/pi-ai", () => ({ complete: vi.fn() }));
vi.mock("@earendil-works/pi-coding-agent", () => ({
  BorderedLoader: class FakeLoader {
    signal = new AbortController().signal;
    onAbort?: () => void;
    constructor(_tui: unknown, _theme: unknown, _msg: string) {}
  },
}));

type CompleteResult = {
  stopReason: string;
  content: Array<{ type: string; text?: string }>;
};

function textResult(text: string): CompleteResult {
  return { stopReason: "stop", content: [{ type: "text", text }] };
}

const MODEL = { id: "m", provider: "p" } as never;
const AUTH = { apiKey: "sk-test" };
const CONTENT = [{ type: "text" as const, text: "user text" }];

async function importFresh(): Promise<{
  callLlmDirect: typeof import("../../common/llm.js").callLlmDirect;
  callLlmWithLoader: typeof import("../../common/llm.js").callLlmWithLoader;
  complete: ReturnType<typeof vi.fn>;
}> {
  vi.resetModules();
  const llm = await import("../../common/llm.js");
  const ai = await import("@earendil-works/pi-ai");
  vi.clearAllMocks();
  return {
    callLlmDirect: llm.callLlmDirect,
    callLlmWithLoader: llm.callLlmWithLoader,
    complete: vi.mocked(ai.complete),
  };
}

describe("callLlmDirect", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("should return parsed value on success", async () => {
    const { callLlmDirect, complete } = await importFresh();
    complete.mockResolvedValue(textResult("42"));

    const r = await callLlmDirect(MODEL, AUTH, "sys", CONTENT, (t) => Number(t));
    expect(r).toEqual({ ok: true, value: 42 });
  });

  it("should surface parse failures as typed errors", async () => {
    const { callLlmDirect, complete } = await importFresh();
    complete.mockResolvedValue(textResult("not a number"));

    const r = await callLlmDirect(MODEL, AUTH, "sys", CONTENT, () => null);
    expect(r).toEqual({ ok: false, type: "error", message: "LLM returned invalid JSON" });
  });

  it("should surface provider errors with the real message (no swallowing)", async () => {
    const { callLlmDirect, complete } = await importFresh();
    complete.mockRejectedValue(new Error("429 rate limited"));

    const r = await callLlmDirect(MODEL, AUTH, "sys", CONTENT, (t) => t);
    expect(r).toEqual({ ok: false, type: "error", message: "429 rate limited" });
  });

  it("should map aborted stopReason to cancelled", async () => {
    const { callLlmDirect, complete } = await importFresh();
    complete.mockResolvedValue({ stopReason: "aborted", content: [] });

    const r = await callLlmDirect(MODEL, AUTH, "sys", CONTENT, (t) => t);
    expect(r).toEqual({ ok: false, type: "cancelled" });
  });

  it("should error when timeoutMs is exceeded (T: per-stage timeouts)", async () => {
    const { callLlmDirect, complete } = await importFresh();
    complete.mockReturnValue(new Promise(() => {})); // never settles

    const pending = callLlmDirect(MODEL, AUTH, "sys", CONTENT, (t) => t, undefined, 1000);
    const assertion = expect(pending).resolves.toEqual({
      ok: false,
      type: "error",
      message: "LLM call timed out after 1000ms",
    });
    await vi.advanceTimersByTimeAsync(1100);
    await assertion;
  });

  it("should not arm a timer when timeoutMs is absent", async () => {
    const { callLlmDirect, complete } = await importFresh();
    complete.mockResolvedValue(textResult("ok"));

    const r = await callLlmDirect(MODEL, AUTH, "sys", CONTENT, (t) => t);
    expect(r).toEqual({ ok: true, value: "ok" });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("callLlmWithLoader should deliver parsed results through done and support abort", async () => {
    vi.useRealTimers();
    const { callLlmWithLoader, complete } = await importFresh();
    complete.mockResolvedValue(textResult("  hi  "));

    const done = vi.fn();
    callLlmWithLoader({}, {}, done, "Loading…", MODEL, AUTH, "sys", CONTENT, (t) => t.trim());
    await vi.waitFor(() => expect(done).toHaveBeenCalledWith({ ok: true, value: "hi" }));

    complete.mockReturnValue(new Promise(() => {}));
    const done2 = vi.fn();
    const loader = callLlmWithLoader(
      {},
      {},
      done2,
      "Loading…",
      MODEL,
      AUTH,
      "sys",
      CONTENT,
      (t) => t,
    );
    loader.onAbort?.();
    expect(done2).toHaveBeenCalledWith({ ok: false, type: "cancelled" });
  });
});
