/**
 * Integration tests for citation validation in batch_create_para_docs.
 *
 * Verifies that:
 * - A batch with all valid citekeys succeeds
 * - A batch with any doc having missing citekeys is ENTIRELY rejected
 * - The error message lists all violating documents and their missing keys
 */

import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { createDb, initDb } from "../../extensions/para-knowledge/sqlite-init.js";

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:os")>();
  return {
    ...actual,
    homedir: vi.fn(),
  };
});

describe("batch_create_para_docs citation validation", () => {
  let tmpDir: string;
  let fakeHome: string;
  let knowledgeDir: string;
  let projectDir: string;
  let registeredTool: Record<string, unknown> | null;

  beforeEach(() => {
    tmpDir = mkdtempSync("/tmp/batchCreate-cite-test-");
    fakeHome = join(tmpDir, "fake-home");
    mkdirSync(fakeHome, { recursive: true });
    vi.mocked(homedir).mockReturnValue(fakeHome);

    knowledgeDir = join(tmpDir, "knowledge");
    projectDir = join(tmpDir, "project");
    mkdirSync(knowledgeDir, { recursive: true });
    mkdirSync(projectDir, { recursive: true });

    process.env.KNOWLEDGE_DIR = knowledgeDir;
    process.env.KNOWLEDGE_DB = "notes.db";

    registeredTool = null;

    // Pre-populate DB with citations
    const db = createDb(join(knowledgeDir, "notes.db"));
    initDb(db);
    const insert = db.prepare(
      "INSERT INTO citations (citekey, bibtex, doi, source_url, created, updated) VALUES (?, ?, ?, ?, ?, ?)",
    );
    insert.run("smith2024", "@misc{smith2024,…}", null, null, "2024-01-01", "2024-01-01");
    insert.run("jones2023", "@misc{jones2023,…}", null, null, "2023-01-01", "2023-01-01");
    db.close();
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    delete process.env.KNOWLEDGE_DIR;
    delete process.env.KNOWLEDGE_DB;
  });

  async function getExecute(): Promise<
    (
      toolCallId: string,
      params: Record<string, unknown>,
      signal: AbortSignal | undefined,
      onUpdate: unknown,
      ctx: ExtensionContext,
    ) => Promise<{
      content: Array<{ type: string; text: string }>;
      details: Record<string, unknown>;
    }>
  > {
    vi.resetModules();
    const mod = await import("../../extensions/batch-create/index.js");

    const mockPi = {
      registerTool: (tool: Record<string, unknown>) => {
        registeredTool = tool;
      },
      on: () => {},
    } as unknown as ExtensionAPI;

    mod.default(mockPi);
    expect(registeredTool).not.toBeNull();

    const tool = registeredTool!;
    return tool.execute as (
      toolCallId: string,
      params: Record<string, unknown>,
      signal: AbortSignal | undefined,
      onUpdate: unknown,
      ctx: ExtensionContext,
    ) => Promise<{
      content: Array<{ type: string; text: string }>;
      details: Record<string, unknown>;
    }>;
  }

  it("should succeed when all docs have valid citekeys", async () => {
    const execute = await getExecute();

    const result = await execute(
      "batch-1",
      {
        documents: [
          {
            title: "Doc One",
            content: "Summary of @smith2024 findings.",
            tags: ["test"],
          },
          {
            title: "Doc Two",
            content: "Related work by @jones2023.",
            tags: ["test"],
          },
        ],
        autoLink: false,
      },
      undefined,
      undefined,
      { cwd: projectDir } as ExtensionContext,
    );

    // Should succeed — all citekeys exist
    expect(result.details.error).toBeUndefined();
    expect(result.details.count).toBe(2);
  });

  it("should reject entire batch when any doc has missing citekey", async () => {
    const execute = await getExecute();

    const result = await execute(
      "batch-2",
      {
        documents: [
          {
            title: "Good Doc",
            content: "Summary of @smith2024.",
            tags: ["test"],
          },
          {
            title: "Bad Doc",
            content: "References @missingKey here.",
            tags: ["test"],
          },
          {
            title: "Also Good Doc",
            content: "Related work by @jones2023.",
            tags: ["test"],
          },
        ],
        autoLink: false,
      },
      undefined,
      undefined,
      { cwd: projectDir } as ExtensionContext,
    );

    // Entire batch rejected
    expect(result.details.error).toBe("CITATION_VIOLATIONS");
    // The error should reference the bad doc
    const content = result.content[0].text;
    expect(content).toContain("Bad Doc");
    expect(content).toContain("missingKey");

    // No documents should have been created
    expect(result.details.created).toBeUndefined();
    expect(result.details.count).toBeUndefined();
  });

  it("should reject entire batch with multiple violating docs", async () => {
    const execute = await getExecute();

    const result = await execute(
      "batch-3",
      {
        documents: [
          {
            title: "First Bad",
            content: "References @keyA.",
            tags: ["test"],
          },
          {
            title: "Second Bad",
            content: "References @keyB and @keyC.",
            tags: ["test"],
          },
          {
            title: "Good Doc",
            content: "Summary of @smith2024.",
            tags: ["test"],
          },
        ],
        autoLink: false,
      },
      undefined,
      undefined,
      { cwd: projectDir } as ExtensionContext,
    );

    // Entire batch rejected
    expect(result.details.error).toBe("CITATION_VIOLATIONS");
    const content = result.content[0].text;
    expect(content).toContain("First Bad");
    expect(content).toContain("Second Bad");
    expect(content).toContain("keyA");
    expect(content).toContain("keyB");
    expect(content).toContain("keyC");

    // Good doc should NOT have been created
    expect(result.details.created).toBeUndefined();
  });

  it("should succeed when content has no citations (no validation needed)", async () => {
    const execute = await getExecute();

    const result = await execute(
      "batch-4",
      {
        documents: [
          {
            title: "No Citations",
            content: "Plain text without citekeys.",
            tags: ["test"],
          },
        ],
        autoLink: false,
      },
      undefined,
      undefined,
      { cwd: projectDir } as ExtensionContext,
    );

    expect(result.details.error).toBeUndefined();
    expect(result.details.count).toBe(1);
  });

  it("should reject batch when a doc has @? placeholder", async () => {
    const execute = await getExecute();

    const result = await execute(
      "batch-5",
      {
        documents: [
          {
            title: "Unresolved Doc",
            content: "Has @? placeholder citation.",
            tags: ["test"],
          },
        ],
        autoLink: false,
      },
      undefined,
      undefined,
      { cwd: projectDir } as ExtensionContext,
    );

    expect(result.details.error).toBe("CITATION_VIOLATIONS");
    expect(result.content[0].text).toContain("Unresolved Doc");
    expect(result.content[0].text).toContain("?");
  });
});
