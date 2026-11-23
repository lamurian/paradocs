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

  it("labels text hits by relevance and lists relevant hits before weak hits", async () => {
    mkdirSync(knowledgeDir, { recursive: true });

    const { createDb, initDb, indexFile } =
      await import("../../extensions/para-knowledge/db-sqlite.ts");
    const base = {
      author: "pi",
      editor: "",
      created: "2020-01-01T00:00:00.000Z",
      modified: "2020-01-01T00:00:00.000Z",
      file_mtime: "2020-01-01T00:00:00.000Z",
      source_url: null,
    };
    const db = createDb(resolve(knowledgeDir, "notes.db"));
    initDb(db);
    indexFile(db, {
      ...base,
      path: "Projects/quantum-widgets.md",
      title: "Quantum Widgets",
      body: "A strong note about quantum widgets.",
      tags: ["note"],
    });
    indexFile(db, {
      ...base,
      path: "Projects/weak-one.md",
      title: "Unrelated Notes",
      body: "quantum widgets ".repeat(30),
      tags: ["misc"],
    });
    indexFile(db, {
      ...base,
      path: "Projects/weak-two.md",
      title: "Another Note",
      body: "quantum widgets ".repeat(10),
      tags: ["misc"],
    });
    db.close();

    const tool = await loadTool();
    const result = await tool.execute(
      "call-relevance",
      { query: "quantum widgets" },
      undefined,
      undefined,
      { cwd: projectDir } as ExtensionContext,
    );

    const text = result.content[0]?.text ?? "";
    const lines = text.split("\n").filter((line) => line.startsWith("- ["));
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain("[Quantum Widgets]");
    expect(lines[0]).toMatch(/\(score: -?\d+\.\d{2}, relevance: relevant \d\.\d{2}\)/);
    expect(lines[1]).toMatch(/\(score: -?\d+\.\d{2}, relevance: weak \d\.\d{2}\)/);
    expect(lines[2]).toMatch(/\(score: -?\d+\.\d{2}, relevance: weak \d\.\d{2}\)/);

    const weakScores = lines
      .slice(1)
      .map((line) => Number(line.match(/\(score: (-?\d+\.\d{2}),/)?.[1]));
    expect(weakScores[0]).toBeLessThanOrEqual(weakScores[1]);

    const results = result.details.results as Array<{
      path: string;
      relevance: number;
      relevant: boolean;
    }>;
    expect(results.map((entry) => entry.path)).toEqual(
      lines.map((line) => line.match(/\]\(([^)]+)\)/)?.[1]),
    );
    expect(results[0].path).toBe("Projects/quantum-widgets.md");
    expect(results[0].relevant).toBe(true);
    expect(typeof results[0].relevance).toBe("number");
    expect(results.slice(1).every((entry) => !entry.relevant)).toBe(true);
  });

  it("keeps tag-only hits labelled tag-only", async () => {
    mkdirSync(knowledgeDir, { recursive: true });

    const { createDb, initDb, indexFile } =
      await import("../../extensions/para-knowledge/db-sqlite.ts");
    const db = createDb(resolve(knowledgeDir, "notes.db"));
    initDb(db);
    indexFile(db, {
      path: "Projects/tagged.md",
      title: "Tagged Note",
      body: "Body without the searched term.",
      tags: ["specialtag"],
      author: "pi",
      editor: "",
      created: "2020-01-01T00:00:00.000Z",
      modified: "2020-01-01T00:00:00.000Z",
      file_mtime: "2020-01-01T00:00:00.000Z",
      source_url: null,
    });
    db.close();

    const tool = await loadTool();
    const result = await tool.execute(
      "call-tag-only",
      { query: "missingterm", tags: ["specialtag"] },
      undefined,
      undefined,
      { cwd: projectDir } as ExtensionContext,
    );

    const text = result.content[0]?.text ?? "";
    expect(text).toContain("[Tagged Note]");
    expect(text).toMatch(/relevance: tag-only/);
    expect(text).not.toMatch(/relevance: (relevant|weak)/);
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
