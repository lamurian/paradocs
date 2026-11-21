/**
 * Tests for search_para_docs — freshness output and missing-database guidance.
 *
 * The tool opens notes.db read-only: it must never create or rebuild the file.
 */

import { mkdtempSync, mkdirSync, rmSync, existsSync } from "node:fs";
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

interface ToolResult {
  content: Array<{ type: string; text: string }>;
  details: Record<string, unknown>;
}

interface RegisteredTool {
  execute: (
    toolCallId: string,
    params: Record<string, unknown>,
    signal: AbortSignal | undefined,
    onUpdate: unknown,
    ctx: ExtensionContext,
  ) => Promise<ToolResult>;
}

describe("search_para_docs read-only behaviour", () => {
  let tmpDir: string;
  let fakeHome: string;
  let knowledgeDir: string;
  let projectDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync("/tmp/searchDocs-test-");
    fakeHome = join(tmpDir, "fake-home");
    mkdirSync(fakeHome, { recursive: true });
    vi.mocked(homedir).mockReturnValue(fakeHome);

    knowledgeDir = join(tmpDir, "knowledge");
    projectDir = join(tmpDir, "project");
    mkdirSync(projectDir, { recursive: true });

    process.env.KNOWLEDGE_DIR = knowledgeDir;
    process.env.KNOWLEDGE_DB = "notes.db";
    vi.resetModules();
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    delete process.env.KNOWLEDGE_DIR;
    delete process.env.KNOWLEDGE_DB;
  });

  async function loadTool(): Promise<RegisteredTool> {
    const { registerSearchDocsTool } =
      await import("../../extensions/para-knowledge/tools/searchDocs.ts");
    let registered: RegisteredTool | null = null;
    const mockPi = {
      registerTool: (tool: RegisteredTool) => {
        registered = tool;
      },
      on: () => {},
    } as unknown as ExtensionAPI;
    registerSearchDocsTool(mockPi);
    expect(registered).not.toBeNull();
    return registered as unknown as RegisteredTool;
  }

  it("prints a freshness line per hit and includes Freshness objects in details", async () => {
    mkdirSync(knowledgeDir, { recursive: true });

    const { createDb, initDb, indexFile } =
      await import("../../extensions/para-knowledge/db-sqlite.ts");
    const reviewed = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
    const db = createDb(resolve(knowledgeDir, "notes.db"));
    initDb(db);
    indexFile(db, {
      path: "Projects/freshness-doc.md",
      title: "Freshness Doc",
      body: "Body about a freshness search term.",
      tags: ["test"],
      author: "pi",
      editor: "",
      created: "2020-01-01T00:00:00.000Z",
      modified: "2020-01-01T00:00:00.000Z",
      file_mtime: "2020-01-01T00:00:00.000Z",
      source_url: null,
      reviewed,
      reviewInterval: null,
    });
    db.close();

    const tool = await loadTool();
    const result = await tool.execute("call-fresh", { query: "freshness" }, undefined, undefined, {
      cwd: projectDir,
    } as ExtensionContext);

    const text = result.content[0]?.text ?? "";
    expect(text).toMatch(/freshness: fresh \(age \d+d \/ window 365d, basis reviewed\)/);

    const results = result.details.results as Array<{ freshness: Record<string, unknown> }>;
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].freshness).toBeDefined();
    expect(results[0].freshness.status).toBe("fresh");
    expect(results[0].freshness.basis).toBe("reviewed");
    expect(results[0].freshness.windowDays).toBe(365);
  });

  it("returns missing-db guidance and leaves no notes.db behind", async () => {
    const tool = await loadTool();
    const dbPath = resolve(knowledgeDir, "notes.db");

    expect(existsSync(dbPath)).toBe(false);

    const result = await tool.execute("call-missing", { query: "anything" }, undefined, undefined, {
      cwd: projectDir,
    } as ExtensionContext);

    const text = result.content[0]?.text ?? "";
    expect(text).toBe(
      `notes.db not found at ${dbPath}. It is built by the main session (session_start reindex) or /para-ingest.`,
    );
    expect(existsSync(dbPath)).toBe(false);
  });
});
