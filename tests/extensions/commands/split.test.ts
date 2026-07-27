/* eslint-disable */

/**
 * Tests for the /split command handler.
 *
 * @module tests/extensions/commands/split
 */

import { resolve } from "node:path";

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { createSplitHandler, splitDescription } from "../../../extensions/commands/split.js";

import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

// Mock fs/promises
vi.mock("node:fs/promises", () => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
}));

// Mock the atomicity module
vi.mock("../../../common/atomicity.js", () => ({
  validateAtomicity: vi.fn(),
}));

describe("split command handler", () => {
  let mockPi: Partial<ExtensionAPI>;
  let mockCtx: Partial<ExtensionCommandContext>;
  let handler: ReturnType<typeof createSplitHandler>;

  beforeEach(() => {
    vi.clearAllMocks();

    mockPi = {
      registerCommand: vi.fn(),
    };

    mockCtx = {
      cwd: "/test/project",
      model: { id: "test-model", provider: "test", name: "test" } as never,
      ui: {
        notify: vi.fn(),
        confirm: vi.fn().mockResolvedValue(true),
      } as never,
    };

    handler = createSplitHandler(mockPi as never);
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe("splitDescription", () => {
    it("should have a description", () => {
      expect(splitDescription).toBeDefined();
      expect(typeof splitDescription).toBe("string");
      expect(splitDescription.length).toBeGreaterThan(0);
    });
  });

  describe("createSplitHandler", () => {
    it("should return a handler function", () => {
      expect(typeof handler).toBe("function");
    });

    it("should error when no file path provided", async () => {
      await handler("", mockCtx as never);

      expect(mockCtx.ui!.notify).toHaveBeenCalledWith("Usage: /split <path/to/file.md>", "error");
    });

    it("should read file from relative path", async () => {
      const { readFile } = await import("node:fs/promises");
      vi.mocked(readFile).mockResolvedValue(`---
title: "Test Document"
tags: ["test"]
---
## Summary

This is a test document.`);

      const { validateAtomicity } = await import("../../../common/atomicity.js");
      vi.mocked(validateAtomicity).mockResolvedValue({
        valid: true,
        message: "Single coherent topic.",
      });

      await handler("Resources/test.md", mockCtx as never);

      expect(readFile).toHaveBeenCalledWith(resolve("/test/project", "Resources/test.md"), "utf-8");
    });

    it("should notify 'already atomic' when document is atomic", async () => {
      const { readFile } = await import("node:fs/promises");
      vi.mocked(readFile).mockResolvedValue(`---
title: "Test Document"
tags: ["test"]
---
## Summary

This is a single topic document.`);

      const { validateAtomicity } = await import("../../../common/atomicity.js");
      vi.mocked(validateAtomicity).mockResolvedValue({
        valid: true,
        message: "Single coherent topic.",
      });

      await handler("Resources/test.md", mockCtx as never);

      expect(mockCtx.ui!.notify).toHaveBeenCalledWith(
        "Document is already atomic — no split needed",
        "info",
      );
    });
  });
});
