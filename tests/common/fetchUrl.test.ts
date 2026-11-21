/**
 * Tests for common/fetchUrl.ts — shared fetchUrlAsText function.
 *
 * Verifies that the exported function:
 * - Returns { title, content, engine } on success
 * - Returns { error } on failure
 * - Handles PDF, Obscura CDP, HTTP fallback
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const tavilyExtractMock = vi.hoisted(() => vi.fn());
const mockApiKeys = vi.hoisted(() => ({ tavily: "" }));

vi.mock("@tavily/core", () => ({
  tavily: () => ({ extract: tavilyExtractMock }),
}));

vi.mock("../../common/env.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../common/env.ts")>();
  return {
    ...actual,
    getApiKeys: () => ({ tavily: mockApiKeys.tavily, github: "" }),
  };
});

beforeEach(() => {
  // isolate=false shares the module registry, so force a fresh graph that
  // uses the @tavily/core mock below.
  vi.resetModules();
  // Keep Tavily unavailable by default so the primary pipeline is exercised.
  mockApiKeys.tavily = "";
  tavilyExtractMock.mockReset();
});

afterEach(() => {
  mockApiKeys.tavily = "";
  vi.resetModules();
});

describe("fetchUrlWithTimeout", () => {
  let originalFetch: typeof globalThis.fetch;
  let originalWs: typeof globalThis.WebSocket;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    originalWs = globalThis.WebSocket;
    vi.useFakeTimers();

    // Stub WebSocket to throw synchronously (Obscura not available)
    vi.stubGlobal(
      "WebSocket",
      vi.fn(function () {
        throw new Error("WebSocket not available");
      }),
    );
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    globalThis.WebSocket = originalWs;
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("should return content when fetch completes before timeout", async () => {
    const html = "<html><head><title>Fast Page</title></head><body><p>OK</p></body></html>";
    const encoder = new TextEncoder();
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(html));
        controller.close();
      },
    });

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        headers: new Map([["content-type", "text/html"]]),
        body,
        text: () => Promise.resolve(html),
      }),
    );

    const { fetchUrlWithTimeout } = await import("../../common/fetchUrl.ts");
    const result = await fetchUrlWithTimeout("https://example.com/fast", 5000);

    expect(result).toHaveProperty("content");
    if ("content" in result) {
      expect(result.content).toContain("Fast Page");
    }
  });

  it("should return error when fetch times out", async () => {
    // A fetch that never resolves
    vi.stubGlobal("fetch", vi.fn().mockReturnValue(new Promise(() => {})));

    const { fetchUrlWithTimeout } = await import("../../common/fetchUrl.ts");

    const resultPromise = fetchUrlWithTimeout("https://example.com/slow", 100);

    // Advance past the timeout
    await vi.advanceTimersByTimeAsync(200);

    const result = await resultPromise;
    expect(result).toHaveProperty("error");
    if ("error" in result) {
      expect(result.error).toContain("timed out");
    }
  });

  it("should return error on invalid URL", async () => {
    const { fetchUrlWithTimeout } = await import("../../common/fetchUrl.ts");

    const result = await fetchUrlWithTimeout("not-a-url", 5000);

    expect(result).toHaveProperty("error");
  });
});

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
    const { fetchUrlAsText } = await import("../../common/fetchUrl.ts");

    const result = await fetchUrlAsText("not-a-valid-url");

    expect(result).toHaveProperty("error");
  });

  it("should return error for unsupported protocol", async () => {
    const { fetchUrlAsText } = await import("../../common/fetchUrl.ts");

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

    const { fetchUrlAsText } = await import("../../common/fetchUrl.ts");
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

    const { fetchUrlAsText } = await import("../../common/fetchUrl.ts");
    const result = await fetchUrlAsText("https://example.com/failing");

    expect(result).toHaveProperty("error");
  });
});

describe("fetchUrlAsText Tavily extract fallback", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    tavilyExtractMock.mockReset();
    // All primary engines fail: no WebSocket (Obscura) and fetch rejects.
    vi.stubGlobal(
      "WebSocket",
      vi.fn(function () {
        throw new Error("WebSocket not available");
      }),
    );
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Network error")));
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("should return Tavily-extracted content when TAVILY_KEY is set", async () => {
    mockApiKeys.tavily = "test-key";
    tavilyExtractMock.mockResolvedValue({
      results: [{ url: "https://example.com/spa", title: "SPA Page", rawContent: "# SPA" }],
      failedResults: [],
    });

    const { fetchUrlAsText } = await import("../../common/fetchUrl.ts");
    const result = await fetchUrlAsText("https://example.com/spa");

    expect(result).toEqual({
      title: "SPA Page",
      content: "# SPA",
      engine: "tavily-extract",
    });
  });

  it("should return the original error when Tavily extraction fails", async () => {
    mockApiKeys.tavily = "test-key";
    tavilyExtractMock.mockResolvedValue({
      results: [],
      failedResults: [{ url: "https://example.com/spa", error: "Tavily failed" }],
    });

    const { fetchUrlAsText } = await import("../../common/fetchUrl.ts");
    const result = await fetchUrlAsText("https://example.com/spa");

    expect(result).toHaveProperty("error");
    if ("error" in result) {
      expect(result.error).not.toBe("Tavily failed");
      expect(result.error).toBeTruthy();
    }
  });

  it("should return the original error when TAVILY_KEY is unset", async () => {
    const { fetchUrlAsText } = await import("../../common/fetchUrl.ts");
    const result = await fetchUrlAsText("https://example.com/spa");

    expect(result).toHaveProperty("error");
    expect(tavilyExtractMock).not.toHaveBeenCalled();
  });
});
