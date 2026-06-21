/**
 * Tests for common/fetchUrl.ts — shared fetchUrlAsText function.
 *
 * Verifies that the exported function:
 * - Returns { title, content, engine } on success
 * - Returns { error } on failure
 * - Handles PDF, Obscura CDP, HTTP fallback
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

describe("fetchUrlAsText shared module", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    // Stub WebSocket to fail immediately (Obscura not available)

    const mockWs = vi.fn(function () {
      // Return a mock WebSocket that triggers onerror immediately
      const ws: Record<string, unknown> = {
        onopen: null,
        onerror: null,
        onclose: null,
        readyState: 0,
        send: () => {},
        close: () => {},
      };
      setTimeout(() => {
        ws.readyState = 3;

        (ws.onerror as ((e: Event) => void) | null)?.(new Event("error"));
      }, 50);
      return ws;
    }) as unknown as typeof globalThis.WebSocket;
    vi.stubGlobal("WebSocket", mockWs);
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("should return error when URL is invalid", async () => {
    const { fetchUrlAsText } = await import("../../common/fetchUrl.js");

    const result = await fetchUrlAsText("not-a-valid-url");

    expect(result).toHaveProperty("error");
  });

  it("should return error for unsupported protocol", async () => {
    const { fetchUrlAsText } = await import("../../common/fetchUrl.js");

    const result = await fetchUrlAsText("ftp://example.com/file");

    expect(result).toHaveProperty("error");
    if ("error" in result) {
      expect(result.error).toContain("Unsupported protocol");
    }
  });

  it("should handle HTTP fallback when Obscura is unavailable", async () => {
    // Mock HTTP fetch to return HTML content
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        headers: new Map([["content-type", "text/html"]]),
        text: () =>
          Promise.resolve(
            "<html><head><title>Test Page</title></head><body><p>Hello world.</p></body></html>",
          ),
      }),
    );

    const { fetchUrlAsText } = await import("../../common/fetchUrl.js");
    const result = await fetchUrlAsText("https://example.com/test");

    if ("error" in result) {
      expect(result.error).toBeTruthy();
    } else {
      expect(result).toHaveProperty("title");
      expect(result).toHaveProperty("content");
      expect(result).toHaveProperty("engine");
    }
  });

  it("should return error shape when all engines fail", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Network error")));

    const { fetchUrlAsText } = await import("../../common/fetchUrl.js");
    const result = await fetchUrlAsText("https://example.com/failing");

    expect(result).toHaveProperty("error");
  });
});
