/**
 * Tests for extensions/link-summarizer/index.ts — fetch_url only.
 *
 * Uses a fake pi and mocks common/fetchUrl.ts so no network is touched.
 *
 * @module tests/link-summarizer/index
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { Mock } from "vitest";

const fetchUrlAsTextMock = vi.hoisted(() => vi.fn());

vi.mock("../../common/fetchUrl.ts", () => ({
  fetchUrlAsText: fetchUrlAsTextMock,
}));

interface ToolResult {
  content: Array<{ type: string; text: string }>;
  details: Record<string, unknown>;
  isError?: boolean;
}

interface RegisteredTool {
  name: string;
  label: string;
  execute: (
    toolCallId: string,
    params: { url: string },
    signal: AbortSignal | undefined,
    onUpdate: unknown,
    ctx: unknown,
  ) => Promise<ToolResult>;
}

describe("link-summarizer extension", () => {
  let mockPi: { registerTool: Mock<(tool: RegisteredTool) => void> };

  beforeEach(() => {
    mockPi = { registerTool: vi.fn() };
    fetchUrlAsTextMock.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  function registeredTools(): RegisteredTool[] {
    return mockPi.registerTool.mock.calls.map((call) => call[0]);
  }

  it("should register only the fetch_url tool", async () => {
    const extension = (await import("../../extensions/link-summarizer/index.ts")).default;
    extension(mockPi as unknown as ExtensionAPI);

    const tools = registeredTools();
    expect(tools).toHaveLength(1);
    expect(tools.map((t) => t.name)).toEqual(["fetch_url"]);
  });

  it("should delegate to fetchUrlAsText and format the result", async () => {
    fetchUrlAsTextMock.mockResolvedValue({
      title: "Example",
      content: "hello world",
      engine: "http-fallback",
    });

    const extension = (await import("../../extensions/link-summarizer/index.ts")).default;
    extension(mockPi as unknown as ExtensionAPI);
    const tool = registeredTools()[0];

    const result = await tool.execute(
      "call-1",
      { url: "https://example.com" },
      undefined,
      undefined,
      {},
    );

    expect(fetchUrlAsTextMock).toHaveBeenCalledWith("https://example.com", undefined);
    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain("Example");
    expect(result.content[0].text).toContain("hello world");
    expect(result.details.engine).toBe("http-fallback");
  });

  it("should label the tavily-extract engine Tavily extract", async () => {
    fetchUrlAsTextMock.mockResolvedValue({
      title: "SPA",
      content: "rendered",
      engine: "tavily-extract",
    });

    const extension = (await import("../../extensions/link-summarizer/index.ts")).default;
    extension(mockPi as unknown as ExtensionAPI);
    const tool = registeredTools()[0];

    const result = await tool.execute(
      "call-1",
      { url: "https://example.com/spa" },
      undefined,
      undefined,
      {},
    );

    expect(result.content[0].text).toContain("Tavily extract");
  });

  it("should return an error response when extraction fails", async () => {
    fetchUrlAsTextMock.mockResolvedValue({ error: "boom" });

    const extension = (await import("../../extensions/link-summarizer/index.ts")).default;
    extension(mockPi as unknown as ExtensionAPI);
    const tool = registeredTools()[0];

    const result = await tool.execute(
      "call-1",
      { url: "https://example.com" },
      undefined,
      undefined,
      {},
    );

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("boom");
    expect(result.details).not.toHaveProperty("queuedForTavily");
  });
});
