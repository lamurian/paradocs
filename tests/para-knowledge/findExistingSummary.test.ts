/**
 * Tests for find_existing_summary — verifies that content similarity
 * matching reads documents from KNOWLEDGE_DIR rather than ctx.cwd.
 */

import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

describe("find_existing_summary path resolution", () => {
  let tmpDir: string;
  let knowledgeDir: string;
  let projectDir: string;
  let registeredTool: Record<string, unknown> | null;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(homedir(), "findExisting-test-"));
    knowledgeDir = join(tmpDir, "knowledge");
    projectDir = join(tmpDir, "project");
    mkdirSync(projectDir, { recursive: true });

    process.env.KNOWLEDGE_DIR = knowledgeDir;
    process.env.KNOWLEDGE_DB = "notes.db";

    registeredTool = null;
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    delete process.env.KNOWLEDGE_DIR;
    delete process.env.KNOWLEDGE_DB;
  });

  it("should read document bodies from KNOWLEDGE_DIR for similarity matching", async () => {
    vi.resetModules();
    // Create a doc in KNOWLEDGE_DIR/Resources and index it
    const resourcesDir = join(knowledgeDir, "Resources");
    mkdirSync(resourcesDir, { recursive: true });
    writeFileSync(
      join(resourcesDir, "summary-test.md"),
      `---
title: "Summary Test"
tags: [test]
---

This is a unique body of text for similarity matching in the find existing summary test.`,
      "utf-8",
    );

    const { createDb, initDb, indexFile } =
      await import("../../extensions/para-knowledge/db-sqlite.js");
    const db = createDb(resolve(knowledgeDir, "notes.db"));
    initDb(db);
    const body =
      "This is a unique body of text for similarity matching in the find existing summary test.";
    indexFile(db, {
      path: "Resources/summary-test.md",
      title: "Summary Test",
      body,
      tags: ["test"],
      author: "pi",
      editor: "lam",
      created: new Date().toISOString(),
      modified: new Date().toISOString(),
      file_mtime: new Date().toISOString(),
      source_url: null,
    });
    db.close();

    const { registerFindExistingSummaryTool } =
      await import("../../extensions/para-knowledge/tools/findExistingSummary.js");

    const mockPi = {
      registerTool: (tool: Record<string, unknown>) => {
        registeredTool = tool;
      },
      on: () => {},
    } as unknown as ExtensionAPI;

    registerFindExistingSummaryTool(mockPi);
    expect(registeredTool).not.toBeNull();

    const tool = registeredTool!;
    const execute = tool.execute as (
      toolCallId: string,
      params: Record<string, unknown>,
      signal: AbortSignal | undefined,
      onUpdate: unknown,
      ctx: ExtensionContext,
    ) => Promise<{
      content: Array<{ type: string; text: string }>;
      details: Record<string, unknown>;
    }>;

    const result = await execute(
      "call-1",
      {
        url: "https://example.com/unique-test",
        content: body,
      },
      undefined,
      undefined,
      { cwd: projectDir } as ExtensionContext,
    );

    // Should find the doc via content similarity — file read from KNOWLEDGE_DIR
    const details = result.details;
    expect(details.found).toBe(true);
    expect(details.matchType).toBe("content_similarity");
    expect(details.path).toBe("Resources/summary-test.md");
  });

  it("should return not-found when DB has no matching content (sanity check)", async () => {
    vi.resetModules();
    // Create KNOWLEDGE_DIR/notes.db with an unrelated document
    const resourcesDir = join(knowledgeDir, "Resources");
    mkdirSync(resourcesDir, { recursive: true });
    writeFileSync(
      join(resourcesDir, "unrelated.md"),
      `---
title: "Unrelated"
tags: [test]
---

Completely different content that should not match.`,
      "utf-8",
    );

    const { createDb, initDb, indexFile } =
      await import("../../extensions/para-knowledge/db-sqlite.js");
    const db = createDb(resolve(knowledgeDir, "notes.db"));
    initDb(db);
    indexFile(db, {
      path: "Resources/unrelated.md",
      title: "Unrelated",
      body: "Completely different content that should not match.",
      tags: ["test"],
      author: "pi",
      editor: "lam",
      created: new Date().toISOString(),
      modified: new Date().toISOString(),
      file_mtime: new Date().toISOString(),
      source_url: null,
    });
    db.close();

    const { registerFindExistingSummaryTool } =
      await import("../../extensions/para-knowledge/tools/findExistingSummary.js");

    const mockPi = {
      registerTool: (tool: Record<string, unknown>) => {
        registeredTool = tool;
      },
      on: () => {},
    } as unknown as ExtensionAPI;

    registerFindExistingSummaryTool(mockPi);

    const tool = registeredTool!;
    const execute = tool.execute as (
      toolCallId: string,
      params: Record<string, unknown>,
      signal: AbortSignal | undefined,
      onUpdate: unknown,
      ctx: ExtensionContext,
    ) => Promise<{
      content: Array<{ type: string; text: string }>;
      details: Record<string, unknown>;
    }>;

    const result = await execute(
      "call-2",
      {
        url: "https://example.com/something-new",
        content:
          "Something completely new that has nothing to do with the existing unrelated content.",
      },
      undefined,
      undefined,
      { cwd: projectDir } as ExtensionContext,
    );

    const details = result.details;
    expect(details.found).toBe(false);
  });
});
