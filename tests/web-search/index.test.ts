/**
 * Tests for the web_search extension entry point.
 *
 * Regression guard for the env-loading bug: the tool's execute must call
 * configureEnv(ctx.cwd) before searching, otherwise TAVILY_KEY from
 * ~/.pi/agent/.env is never loaded and searchTavily() bails out early.
 *
 * @module tests/web-search/index
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { Mock } from "vitest";

// Spy on the real configureEnv so we can assert it is invoked, without
// breaking the shared env module used by the searxng/tavily backends.
vi.mock("../../common/env.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../common/env.ts")>();
  return {
    ...actual,
    configureEnv: vi.fn(actual.configureEnv),
  };
});

interface ToolExecuteResult {
  content: Array<{ type: string; text: string }>;
  details: {
    query: string;
    tier: number;
    category: string | null;
    tierLabel: string;
    count: number;
    results: Array<{
      title: string;
      url: string;
      snippet: string;
      source_label: string;
      tier: number;
      trust: string;
    }>;
  };
}

interface SearchTool {
  name: string;
  execute: (
    toolCallId: string,
    params: { query: string; tier?: number; category?: string },
    signal: AbortSignal | undefined,
    onUpdate: unknown,
    ctx: { cwd: string },
  ) => Promise<ToolExecuteResult>;
}

const SEARXNG_RESPONSE = {
  results: [
    {
      title: "Result One",
      url: "https://example.edu/research",
      content: "Research content.",
      engine: "google",
    },
    {
      title: "Result Two",
      url: "https://arxiv.org/abs/1234.5678",
      content: "Academic content.",
      engine: "arxiv",
    },
    {
      title: "Result Three",
      url: "https://example.gov/report",
      content: "Government report.",
      engine: "bing",
    },
    {
      title: "Result Four",
      url: "https://example.org/article",
      content: "General article.",
      engine: "google",
    },
  ],
};

describe("web_search extension", () => {
  let mockPi: { registerTool: Mock<(tool: SearchTool) => void> };

  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(SEARXNG_RESPONSE),
      }),
    );
    mockPi = { registerTool: vi.fn() };
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function registeredTool(): SearchTool {
    return mockPi.registerTool.mock.calls[0][0];
  }

  it("should register a tool named web_search", async () => {
    const extension = (await import("../../extensions/web-search/index.ts")).default;
    extension(mockPi as unknown as ExtensionAPI);

    expect(mockPi.registerTool).toHaveBeenCalledTimes(1);
    expect(registeredTool().name).toBe("web_search");
  });

  it("should call configureEnv with ctx.cwd before searching", async () => {
    const { configureEnv } = await import("../../common/env.ts");
    vi.mocked(configureEnv).mockClear();

    const extension = (await import("../../extensions/web-search/index.ts")).default;
    extension(mockPi as unknown as ExtensionAPI);
    const tool = registeredTool();

    const result = await tool.execute("call-1", { query: "test query" }, undefined, undefined, {
      cwd: "/test/project",
    });

    expect(configureEnv).toHaveBeenCalledWith("/test/project");
    expect(result.content[0].text).toContain("test query");
  });

  it("should run the search through the shared orchestrator and format output", async () => {
    const extension = (await import("../../extensions/web-search/index.ts")).default;
    extension(mockPi as unknown as ExtensionAPI);
    const tool = registeredTool();

    const result = await tool.execute(
      "call-2",
      { query: "quantum computing", tier: 1 },
      undefined,
      undefined,
      { cwd: "/test/project" },
    );

    expect(result.content[0].text).toContain("Search results");
    expect(result.details.count).toBe(4);
    expect(result.details.tier).toBe(1);
  });

  it("should list the trust class of every result in text and details", async () => {
    const extension = (await import("../../extensions/web-search/index.ts")).default;
    extension(mockPi as unknown as ExtensionAPI);
    const tool = registeredTool();

    const result = await tool.execute(
      "call-3",
      { query: "quantum computing", tier: 1 },
      undefined,
      undefined,
      { cwd: "/test/project" },
    );

    const trustByUrl = Object.fromEntries(result.details.results.map((r) => [r.url, r.trust]));
    expect(trustByUrl["https://example.edu/research"]).toBe("gov-edu");
    expect(trustByUrl["https://arxiv.org/abs/1234.5678"]).toBe("preprint");
    expect(trustByUrl["https://example.gov/report"]).toBe("gov-edu");
    expect(trustByUrl["https://example.org/article"]).toBe("unknown");

    expect(result.content[0].text).toContain("[trust: gov-edu]");
    expect(result.content[0].text).toContain("[trust: preprint]");
    expect(result.content[0].text).toContain("[trust: unknown]");
  });
});
