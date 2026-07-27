/* eslint-disable */

/**
 * Tests for the formatAge helper and freshness features of the ask tool.
 *
 * @module tests/commands/tools/formatAge.test
 */

import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:os")>();
  return { ...actual, homedir: vi.fn() };
});

async function runAskTool(
  tool: Record<string, unknown>,
  question: string,
  cwd: string,
): Promise<{ content: Array<{ type: string; text: string }>; details: Record<string, unknown> }> {
  const exec = (q: string) => {
    const fn = tool.execute as (
      id: string,
      params: { question: string },
      sig: AbortSignal | undefined,
      up: unknown,
      ctx: ExtensionContext,
    ) => Promise<{
      content: Array<{ type: string; text: string }>;
      details: Record<string, unknown>;
    }>;
    return fn("call", { question: q }, undefined, undefined, { cwd } as ExtensionContext);
  };
  return exec(question);
}

function getTool(registerTool: ReturnType<typeof vi.fn>): Record<string, unknown> {
  return registerTool.mock.calls[0][0] as Record<string, unknown>;
}

// ── formatAge unit tests ──────────────────────────────────────────

describe("formatAge", () => {
  const ASK = "../../../extensions/commands/tools/ask.js";

  it("should return 'no date' for null", async () => {
    const { formatAge } = await import(ASK);
    expect(formatAge(null)).toBe("no date");
  });
  it("should return 'today' for current date", async () => {
    const { formatAge } = await import(ASK);
    expect(formatAge(new Date().toISOString())).toBe("today");
  });
  it("should return 'yesterday' for one day ago", async () => {
    const { formatAge } = await import(ASK);
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    expect(formatAge(yesterday)).toBe("yesterday");
  });
  it("should return 'X days old' for recent dates", async () => {
    const { formatAge } = await import(ASK);
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
    expect(formatAge(twoDaysAgo)).toBe("2 days old");
  });
  it("should return 'X weeks old' for dates weeks ago", async () => {
    const { formatAge } = await import(ASK);
    const threeWeeksAgo = new Date(Date.now() - 21 * 24 * 60 * 60 * 1000).toISOString();
    expect(formatAge(threeWeeksAgo)).toBe("3 weeks old");
  });
  it("should return 'X months old' for dates months ago", async () => {
    const { formatAge } = await import(ASK);
    const twoMonthsAgo = new Date(Date.now() - 61 * 24 * 60 * 60 * 1000).toISOString();
    expect(formatAge(twoMonthsAgo)).toBe("2 months old");
  });
  it("should return 'X+ years old' for dates years ago", async () => {
    const { formatAge } = await import(ASK);
    const twoYearsAgo = new Date(Date.now() - 2 * 365 * 24 * 60 * 60 * 1000).toISOString();
    expect(formatAge(twoYearsAgo)).toBe("2+ years old");
  });
  it("should handle future dates gracefully", async () => {
    const { formatAge } = await import(ASK);
    const future = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();
    expect(formatAge(future)).toBe("just now");
  });
  it("should return singular week for 1 week", async () => {
    const { formatAge } = await import(ASK);
    const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    expect(formatAge(oneWeekAgo)).toBe("1 week old");
  });
  it("should return singular month for 1 month", async () => {
    const { formatAge } = await import(ASK);
    const oneMonthAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    expect(formatAge(oneMonthAgo)).toBe("1 month old");
  });
});

// ── Freshness integration tests ──────────────────────────────────

describe("ask tool freshness", () => {
  let tmpDir: string;
  let fakeHome: string;
  let knowledgeDir: string;
  let projectDir: string;

  function writeDoc(area: string, slug: string, title: string, body: string, tags: string[]): void {
    const content = `---
title: "${title}"
tags: [${tags.join(", ")}]
---

${body}`;
    const areaDir = join(knowledgeDir, area);
    mkdirSync(areaDir, { recursive: true });
    writeFileSync(join(areaDir, `${slug}.md`), content, "utf-8");
  }

  beforeEach(() => {
    tmpDir = mkdtempSync("/tmp/ask-freshness-test-");
    fakeHome = join(tmpDir, "fake-home");
    mkdirSync(fakeHome, { recursive: true });
    vi.mocked(homedir).mockReturnValue(fakeHome);
    knowledgeDir = join(tmpDir, "knowledge");
    projectDir = join(tmpDir, "project");
    mkdirSync(projectDir, { recursive: true });
    process.env.KNOWLEDGE_DIR = knowledgeDir;
    process.env.KNOWLEDGE_DB = "notes.db";
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    delete process.env.KNOWLEDGE_DIR;
    delete process.env.KNOWLEDGE_DB;
  });

  it("should include freshness guideline in promptGuidelines", async () => {
    vi.resetModules();
    const { registerAskTool } = await import("../../../extensions/commands/tools/ask.js");
    const registerTool = vi.fn();
    const mockPi = { registerTool, on: () => {} } as unknown as ExtensionAPI;
    registerAskTool(mockPi);
    const guidelines = getTool(registerTool).promptGuidelines as string[];
    expect(guidelines.some((g) => g.toLowerCase().includes("outdated"))).toBe(true);
  });

  it("should include date and age in tool output", async () => {
    vi.resetModules();
    writeDoc("Resources", "old-doc", "Old Document", "## Summary\n\nThis is an old document.", [
      "test",
    ]);
    const { createDb, initDb, indexFile } =
      await import("../../../extensions/para-knowledge/db-sqlite.js");
    const dbPath = resolve(knowledgeDir, "notes.db");
    mkdirSync(knowledgeDir, { recursive: true });
    const db = createDb(dbPath);
    initDb(db);
    indexFile(db, {
      path: "Resources/old-doc.md",
      title: "Old Document",
      body: "## Summary\n\nThis is an old document.",
      tags: ["test"],
      author: "test",
      editor: "",
      created: "2021-03-15T00:00:00.000Z",
      modified: "2021-03-15T00:00:00.000Z",
      file_mtime: "2021-03-15T00:00:00.000Z",
      source_url: null,
    });
    db.close();
    vi.resetModules();
    const { registerAskTool } = await import("../../../extensions/commands/tools/ask.js");
    const registerTool = vi.fn();
    const mockPi = { registerTool, on: () => {} } as unknown as ExtensionAPI;
    registerAskTool(mockPi);
    const result = await runAskTool(getTool(registerTool), "old document outdated", projectDir);
    const content = result.content?.[0]?.text ?? "";
    expect(content).toContain("2021-03-15");
    expect(content).toMatch(/years old|no date|unknown/);
  });
});
