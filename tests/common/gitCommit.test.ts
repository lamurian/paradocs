/**
 * Tests for the knowledge base git commit helper.
 *
 * @module tests/common/gitCommit.test
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks ──────────────────────────────────────────────────────────

const mockExecSync = vi.fn();
const mockExistsSync = vi.fn();

vi.mock("node:child_process", () => ({
  execSync: mockExecSync,
}));

vi.mock("node:fs", () => ({
  existsSync: mockExistsSync,
}));

// Mock env module so getKnowledgeConfig returns a predictable value
vi.mock("../../common/env.js", () => ({
  getKnowledgeConfig: vi.fn().mockReturnValue({
    dir: "/fake/knowledge-base",
    db: "notes.db",
  }),
}));

// ── Tests ──────────────────────────────────────────────────────────

describe("commitKnowledgeBase", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should run git add -A and git commit in KB dir", async () => {
    mockExistsSync.mockReturnValue(true);
    mockExecSync
      .mockReturnValueOnce("") // git add -A (no output)
      .mockReturnValueOnce("") // git commit (no output)
      .mockReturnValueOnce("abc123\n"); // git rev-parse HEAD

    const { commitKnowledgeBase } = await import("../../common/gitCommit.js");
    const result = await commitKnowledgeBase("docs: add synthesis", "/test/cwd");

    expect(mockExistsSync).toHaveBeenCalledWith("/fake/knowledge-base/.git");
    expect(mockExecSync).toHaveBeenCalledWith("git add -A", { cwd: "/fake/knowledge-base" });
    expect(mockExecSync).toHaveBeenCalledWith('git commit -m "docs: add synthesis"', {
      cwd: "/fake/knowledge-base",
    });
    expect(result).toEqual({ ok: true, hash: "abc123" });
  });

  it("should skip gracefully when KB dir is not a git repo", async () => {
    mockExistsSync.mockReturnValue(false);

    const { commitKnowledgeBase } = await import("../../common/gitCommit.js");
    const result = await commitKnowledgeBase("docs: test", "/test/cwd");

    expect(mockExecSync).not.toHaveBeenCalled();
    expect(result).toEqual({ ok: false });
  });

  it("should skip gracefully when there are no changes to commit", async () => {
    mockExistsSync.mockReturnValue(true);
    mockExecSync
      .mockImplementationOnce(() => "") // git add -A succeeds
      .mockImplementationOnce(() => {
        // git commit fails — nothing to commit
        throw new Error("nothing to commit");
      });

    const { commitKnowledgeBase } = await import("../../common/gitCommit.js");
    const result = await commitKnowledgeBase("docs: test", "/test/cwd");

    expect(result).toEqual({ ok: false });
  });

  it("should handle git not installed gracefully", async () => {
    mockExistsSync.mockReturnValue(true);
    mockExecSync.mockImplementationOnce(() => {
      throw new Error("command not found: git");
    });

    const { commitKnowledgeBase } = await import("../../common/gitCommit.js");
    const result = await commitKnowledgeBase("docs: test", "/test/cwd");

    expect(result).toEqual({ ok: false });
  });

  it("should truncate long commit messages to 72 chars", async () => {
    mockExistsSync.mockReturnValue(true);
    mockExecSync.mockReturnValueOnce("").mockReturnValueOnce("").mockReturnValueOnce("def456\n");

    const longMsg = "docs: add synthesis of " + "very long ".repeat(20) + "topic";
    expect(longMsg.length).toBeGreaterThan(72);

    const { commitKnowledgeBase } = await import("../../common/gitCommit.js");
    await commitKnowledgeBase(longMsg, "/test/cwd");

    const commitCall = mockExecSync.mock.calls[1];
    const commitArg = commitCall[0] as string;
    // Extract the message from the git commit command
    const match = commitArg.match(/git commit -m "(.+)"/);
    expect(match).not.toBeNull();
    expect(match![1].length).toBeLessThanOrEqual(72);
  });
});
