import { describe, it, expect, vi } from "vitest";

/**
 * Tests for skill-gate extension.
 * Tests isParaPath and warnGate.
 */

// ─── isParaPath tests ──────────────────────────────────────────────────────

describe("isParaPath", () => {
  it("should return true for Resources/ paths", async () => {
    const { isParaPath } = await import("../extensions/skill-gate.js");
    expect(isParaPath("Resources/some-doc.md")).toBe(true);
  });

  it("should return true for Projects/ paths", async () => {
    const { isParaPath } = await import("../extensions/skill-gate.js");
    expect(isParaPath("Projects/definition-of-resilience.md")).toBe(true);
  });

  it("should return true for Areas/ paths", async () => {
    const { isParaPath } = await import("../extensions/skill-gate.js");
    expect(isParaPath("Areas/health/notes.md")).toBe(true);
  });

  it("should return true for Archives/ paths", async () => {
    const { isParaPath } = await import("../extensions/skill-gate.js");
    expect(isParaPath("Archives/old-project.md")).toBe(true);
  });

  it("should return false for non-PARA paths", async () => {
    const { isParaPath } = await import("../extensions/skill-gate.js");
    expect(isParaPath("some/other/path.md")).toBe(false);
  });

  it("should return false for undefined", async () => {
    const { isParaPath } = await import("../extensions/skill-gate.js");
    expect(isParaPath(undefined)).toBe(false);
  });

  it("should return false for empty string", async () => {
    const { isParaPath } = await import("../extensions/skill-gate.js");
    expect(isParaPath("")).toBe(false);
  });

  it("should match nested PARA paths", async () => {
    const { isParaPath } = await import("../extensions/skill-gate.js");
    expect(isParaPath("Resources/subdir/deep/file.md")).toBe(true);
    expect(isParaPath("Projects/2024/Q1/report.md")).toBe(true);
  });

  it("should not match paths with PARA prefix as substring", async () => {
    const { isParaPath } = await import("../extensions/skill-gate.js");
    expect(isParaPath("MyProjects/ideas.md")).toBe(false);
    expect(isParaPath("ArchivesOld/notes.md")).toBe(false);
  });
});

// ─── warnGate tests ────────────────────────────────────────────────────────

describe("warnGate", () => {
  it("should call ctx.ui.notify with warning level", async () => {
    const { warnGate } = await import("../extensions/skill-gate.js");
    const notify = vi.fn();
    const ctx = { hasUI: true, ui: { notify } };

    warnGate(ctx as never, "Test warning message");

    expect(notify).toHaveBeenCalledWith("Test warning message", "warning");
  });

  it("should not call notify when hasUI is false", async () => {
    const { warnGate } = await import("../extensions/skill-gate.js");
    const notify = vi.fn();
    const ctx = { hasUI: false, ui: { notify } };

    warnGate(ctx as never, "Should not notify");

    expect(notify).not.toHaveBeenCalled();
  });

  it("should not throw when notify throws", async () => {
    const { warnGate } = await import("../extensions/skill-gate.js");
    const notify = vi.fn().mockImplementation(() => {
      throw new Error("notify error");
    });
    const ctx = { hasUI: true, ui: { notify } };

    expect(() => warnGate(ctx as never, "Trigger error")).not.toThrow();
    expect(notify).toHaveBeenCalledTimes(1);
  });
});
