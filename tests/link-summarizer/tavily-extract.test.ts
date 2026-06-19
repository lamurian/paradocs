import { describe, it, expect, beforeEach } from "vitest";

/**
 * Tests for the pending URL queue in tavily-extract.
 * These share module-level state, so we reset before each test.
 */
describe("pending URL queue", () => {
  beforeEach(async () => {
    const mod = await import("../../extensions/link-summarizer/tavily-extract.js");
    mod.clearPending();
  });

  it("should start empty after clearing", async () => {
    const mod = await import("../../extensions/link-summarizer/tavily-extract.js");
    expect(mod.hasPending()).toBe(false);
    expect(mod.getPendingUrls()).toEqual([]);
  });

  it("should add a URL and report it as pending", async () => {
    const mod = await import("../../extensions/link-summarizer/tavily-extract.js");
    mod.addFailedUrl("https://example.com");
    expect(mod.hasPending()).toBe(true);
    expect(mod.getPendingUrls()).toEqual(["https://example.com"]);
  });

  it("should not duplicate URLs", async () => {
    const mod = await import("../../extensions/link-summarizer/tavily-extract.js");
    mod.addFailedUrl("https://example.com");
    mod.addFailedUrl("https://example.com");
    expect(mod.getPendingUrls()).toEqual(["https://example.com"]);
  });

  it("should clear all pending URLs", async () => {
    const mod = await import("../../extensions/link-summarizer/tavily-extract.js");
    mod.addFailedUrl("https://a.com");
    mod.addFailedUrl("https://b.com");
    mod.clearPending();
    expect(mod.hasPending()).toBe(false);
    expect(mod.getPendingUrls()).toEqual([]);
  });

  it("should handle multiple unique URLs", async () => {
    const mod = await import("../../extensions/link-summarizer/tavily-extract.js");
    mod.addFailedUrl("https://a.com");
    mod.addFailedUrl("https://b.com");
    mod.addFailedUrl("https://c.com");
    expect(mod.getPendingUrls()).toHaveLength(3);
    expect(mod.getPendingUrls()).toContain("https://a.com");
    expect(mod.getPendingUrls()).toContain("https://b.com");
    expect(mod.getPendingUrls()).toContain("https://c.com");
  });

  it("should allow re-adding after clear", async () => {
    const mod = await import("../../extensions/link-summarizer/tavily-extract.js");
    mod.addFailedUrl("https://example.com");
    mod.clearPending();
    mod.addFailedUrl("https://example.com");
    expect(mod.getPendingUrls()).toEqual(["https://example.com"]);
  });
});
