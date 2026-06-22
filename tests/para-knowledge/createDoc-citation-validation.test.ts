/**
 * Integration tests for citation validation in create_para_doc.
 *
 * Verifies that documents with valid @citekey references are created,
 * while documents with missing or unresolved @? citekeys are rejected.
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

describe("create_para_doc citation validation", () => {
  let tmpDir: string;
  let fakeHome: string;
  let knowledgeDir: string;
  let projectDir: string;
  let registeredTool: Record<string, unknown> | null;

  beforeEach(() => {
    tmpDir = mkdtempSync("/tmp/createDoc-cite-test-");
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

    // Pre-populate DB with some citations
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
    const { registerCreateDocTool } =
      await import("../../extensions/para-knowledge/tools/createDoc.js");

    const mockPi = {
      registerTool: (tool: Record<string, unknown>) => {
        registeredTool = tool;
      },
      on: () => {},
    } as unknown as ExtensionAPI;

    registerCreateDocTool(mockPi);
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

  it("should succeed when content has existing citekeys", async () => {
    const execute = await getExecute();

    const result = await execute(
      "call-1",
      {
        title: "Valid Citation Doc",
        content: "This is a summary of @smith2024 and @jones2023 findings.",
        tags: ["test", "citations"],
      },
      undefined,
      undefined,
      { cwd: projectDir } as ExtensionContext,
    );

    // Should succeed — both citekeys exist in DB
    expect(result.details.error).toBeUndefined();
    expect(result.details.title).toBe("Valid Citation Doc");
  });

  it("should reject content with non-existent citekey", async () => {
    const execute = await getExecute();

    const result = await execute(
      "call-2",
      {
        title: "Bad Citation Doc",
        content: "This references @nonexistentKey which is missing.",
        tags: ["test"],
      },
      undefined,
      undefined,
      { cwd: projectDir } as ExtensionContext,
    );

    // Should fail with CITATION_VIOLATION error
    expect(result.details.error).toBe("CITATION_VIOLATION");
    const missing = result.details.missing as string[];
    expect(missing).toContain("nonexistentKey");
    expect(result.content[0].text).toContain("resolve_citation");
  });

  it("should reject content with @? (unresolved placeholder)", async () => {
    const execute = await getExecute();

    const result = await execute(
      "call-3",
      {
        title: "Unresolved Doc",
        content: "This has unresolved @? citation.",
        tags: ["test"],
      },
      undefined,
      undefined,
      { cwd: projectDir } as ExtensionContext,
    );

    expect(result.details.error).toBe("CITATION_VIOLATION");
    const missing = result.details.missing as string[];
    expect(missing).toContain("?");
  });

  it("should list all missing citekeys in error", async () => {
    const execute = await getExecute();

    const result = await execute(
      "call-4",
      {
        title: "Multiple Missing Doc",
        content: "Missing @keyA and @keyB but valid @smith2024.",
        tags: ["test"],
      },
      undefined,
      undefined,
      { cwd: projectDir } as ExtensionContext,
    );

    expect(result.details.error).toBe("CITATION_VIOLATION");
    const missing = result.details.missing as string[];
    expect(missing).toContain("keyA");
    expect(missing).toContain("keyB");
    expect(missing).not.toContain("smith2024");
  });

  it("should not block creation when content has no citations", async () => {
    const execute = await getExecute();

    const result = await execute(
      "call-5",
      {
        title: "No Citations Doc",
        content: "Plain text without any citekey references.",
        tags: ["test"],
      },
      undefined,
      undefined,
      { cwd: projectDir } as ExtensionContext,
    );

    expect(result.details.error).toBeUndefined();
    expect(result.details.title).toBe("No Citations Doc");
  });
});
