/**
 * Tests for extensions/link-summarizer/tavily-extract.ts — extractWithTavily.
 *
 * Mocks @tavily/core so no network calls are made.
 *
 * @module tests/link-summarizer/tavily-extract
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const extractMock = vi.fn();
const mockApiKeys = vi.hoisted(() => ({ tavily: "" }));

vi.mock("@tavily/core", () => ({
  tavily: vi.fn(() => ({ extract: extractMock })),
}));

vi.mock("../../common/env.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../common/env.ts")>();
  return {
    ...actual,
    getApiKeys: () => ({ tavily: mockApiKeys.tavily, github: "" }),
  };
});

describe("extractWithTavily", () => {
  beforeEach(() => {
    // isolate=false shares the module registry, so force a fresh graph that
    // uses the mocks above.
    vi.resetModules();
    extractMock.mockReset();
    mockApiKeys.tavily = "test-key";
  });

  afterEach(() => {
    mockApiKeys.tavily = "";
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("should return title and raw content on success", async () => {
    extractMock.mockResolvedValue({
      results: [{ url: "https://example.com", title: "Example", rawContent: "# Hello" }],
      failedResults: [],
    });

    const { extractWithTavily } =
      await import("../../extensions/link-summarizer/tavily-extract.ts");
    const result = await extractWithTavily("https://example.com");

    expect(result).toEqual({ title: "Example", content: "# Hello" });
    expect(extractMock).toHaveBeenCalledWith(["https://example.com"], {
      format: "markdown",
      extractDepth: "advanced",
    });
  });

  it("should fall back to (no title) when title is null", async () => {
    extractMock.mockResolvedValue({
      results: [{ url: "https://example.com", title: null, rawContent: "body" }],
      failedResults: [],
    });

    const { extractWithTavily } =
      await import("../../extensions/link-summarizer/tavily-extract.ts");
    const result = await extractWithTavily("https://example.com");

    expect(result).toEqual({ title: "(no title)", content: "body" });
  });

  it("should return the failedResults error", async () => {
    extractMock.mockResolvedValue({
      results: [],
      failedResults: [{ url: "https://example.com", error: "403 Forbidden" }],
    });

    const { extractWithTavily } =
      await import("../../extensions/link-summarizer/tavily-extract.ts");
    const result = await extractWithTavily("https://example.com");

    expect(result).toEqual({ error: "403 Forbidden" });
  });

  it("should return an error when TAVILY_KEY is unset", async () => {
    mockApiKeys.tavily = "";

    const { extractWithTavily } =
      await import("../../extensions/link-summarizer/tavily-extract.ts");
    const result = await extractWithTavily("https://example.com");

    expect(result).toHaveProperty("error");
    expect(extractMock).not.toHaveBeenCalled();
  });

  it("should return an error when the client throws", async () => {
    extractMock.mockRejectedValue(new Error("network down"));

    const { extractWithTavily } =
      await import("../../extensions/link-summarizer/tavily-extract.ts");
    const result = await extractWithTavily("https://example.com");

    expect(result).toEqual({ error: "network down" });
  });

  it("should return an error when the signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();

    const { extractWithTavily } =
      await import("../../extensions/link-summarizer/tavily-extract.ts");
    const result = await extractWithTavily("https://example.com", controller.signal);

    expect(result).toHaveProperty("error");
    expect(extractMock).not.toHaveBeenCalled();
  });
});
