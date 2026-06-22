/**
 * Tests that update_para_doc auto-rebuilds notes.db from existing files
 * when the database is missing.
 *
 * Without this fix, updating a doc with no notes.db present would create
 * an empty DB and only index the updated doc — making all previously
 * existing documents unsearchable.
 */

import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:os")>();
  return {
    ...actual,
    homedir: vi.fn(),
  };
});

describe("update_para_doc auto-rebuild on missing DB", () => {
  let tmpDir: string;
  let fakeHome: string;
  let knowledgeDir: string;
  let projectDir: string;
  let registeredTool: Record<string, unknown> | null;

  function writeDoc(area: string, slug: string, title?: string, body?: string): string {
    const content = `---
title: "${title ?? slug}"
author: pi
editor: lam
date: 2026-01-01T00:00:00.000Z
tags: [test]
---

${body ?? `Body of ${slug}. UNIQUE_TERM_${slug}.;`}`;
    const areaDir = join(knowledgeDir, area);
    mkdirSync(areaDir, { recursive: true });
    const filePath = join(areaDir, `${slug}.md`);
    writeFileSync(filePath, content, "utf-8");
    return filePath;
  }

  beforeEach(() => {
    tmpDir = mkdtempSync("/tmp/updateDoc-autoRebuild-test-");
    fakeHome = join(tmpDir, "fake-home");
    mkdirSync(fakeHome, { recursive: true });
    vi.mocked(homedir).mockReturnValue(fakeHome);

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

  it("should rebuild notes.db from existing files when updating a doc", async () => {
    // Write existing docs before notes.db exists
    writeDoc("Resources", "existing-one", "Existing One");
    writeDoc("Resources", "existing-two", "Existing Two");
    // The doc we'll update
    writeDoc("Resources", "to-update", "To Update", "Original body. UNIQUE_TERM_to_update.");

    // notes.db should not exist yet
    expect(existsSync(resolve(knowledgeDir, "notes.db"))).toBe(false);

    vi.resetModules();
    const { registerUpdateDocTool } =
      await import("../../extensions/para-knowledge/tools/updateDoc.js");

    const mockPi = {
      registerTool: (tool: Record<string, unknown>) => {
        registeredTool = tool;
      },
      on: () => {},
    } as unknown as ExtensionAPI;

    registerUpdateDocTool(mockPi);
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

    await execute(
      "call-1",
      {
        path: "Resources/to-update.md",
        content: "Updated body. UNIQUE_TERM_to_update.",
      },
      undefined,
      undefined,
      { cwd: projectDir } as ExtensionContext,
    );

    // notes.db should now exist after rebuild
    expect(existsSync(resolve(knowledgeDir, "notes.db"))).toBe(true);

    // Verify all docs are searchable
    const { createDb, initDb, searchDocs } =
      await import("../../extensions/para-knowledge/db-sqlite.js");
    const db = createDb(resolve(knowledgeDir, "notes.db"));
    initDb(db);

    try {
      // All three docs should be findable by their unique terms
      const allResults = searchDocs(db, "UNIQUE_TERM");
      expect(allResults).toHaveLength(3);

      // The updated doc should be findable
      const updatedResults = searchDocs(db, "UNIQUE_TERM_to_update");
      expect(updatedResults).toHaveLength(1);
      expect(updatedResults[0].title).toBe("To Update");
    } finally {
      db.close();
    }
  });

  it("should work when updating a doc with no other docs on disk", async () => {
    // Write only the doc we'll update
    writeDoc("Resources", "solo-doc", "Solo Doc", "Solo body.");

    vi.resetModules();
    const { registerUpdateDocTool } =
      await import("../../extensions/para-knowledge/tools/updateDoc.js");

    const mockPi = {
      registerTool: (tool: Record<string, unknown>) => {
        registeredTool = tool;
      },
      on: () => {},
    } as unknown as ExtensionAPI;

    registerUpdateDocTool(mockPi);

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

    await execute(
      "call-solo",
      {
        path: "Resources/solo-doc.md",
        content: "Updated solo body.",
      },
      undefined,
      undefined,
      { cwd: projectDir } as ExtensionContext,
    );

    expect(existsSync(resolve(knowledgeDir, "notes.db"))).toBe(true);

    // Verify the updated doc is findable
    const { createDb, initDb, searchDocs } =
      await import("../../extensions/para-knowledge/db-sqlite.js");
    const db = createDb(resolve(knowledgeDir, "notes.db"));
    initDb(db);

    try {
      const results = searchDocs(db, "solo");
      expect(results).toHaveLength(1);
      expect(results[0].title).toBe("Solo Doc");
    } finally {
      db.close();
    }
  });
});
