/**
 * Tests for the ask tool — knowledge base search with full document context.
 *
 * Verifies that the ask tool searches notes.db and returns full document
 * bodies alongside paths, titles, tags, and scores for the agent to evaluate.
 *
 * @module tests/commands/tools/ask.test
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

/** Execute a registered ask tool via its execute method. */
async function runAskTool(
  tool: Record<string, unknown>,
  question: string,
  cwd: string,
): Promise<{
  content: Array<{ type: string; text: string }>;
  details: Record<string, unknown>;
}> {
  // Arrow function wrapper avoids unbound-method lint warning
  const exec = (
    q: string,
  ): Promise<{
    content: Array<{ type: string; text: string }>;
    details: Record<string, unknown>;
  }> => {
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
    return fn("call", { question: q }, undefined, undefined, {
      cwd,
    } as ExtensionContext);
  };
  return exec(question);
}

/** Get the registered tool definition from a mock registerTool spy. */
function getTool(registerTool: ReturnType<typeof vi.fn>): Record<string, unknown> {
  return registerTool.mock.calls[0][0] as Record<string, unknown>;
}

describe("ask tool", () => {
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
    tmpDir = mkdtempSync("/tmp/ask-tool-test-");
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

  it("should register the ask tool with correct name and prompts", async () => {
    vi.resetModules();
    const { registerAskTool } = await import("../../../extensions/commands/tools/ask.js");

    const registerTool = vi.fn();
    const mockPi = {
      registerTool,
      on: () => {},
    } as unknown as ExtensionAPI;

    registerAskTool(mockPi);

    expect(registerTool).toHaveBeenCalledTimes(1);
    const toolDef = getTool(registerTool);
    expect(toolDef.name).toBe("ask");
    expect(Object.prototype.hasOwnProperty.call(toolDef, "promptSnippet")).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(toolDef, "promptGuidelines")).toBe(true);
    const guidelines = toolDef.promptGuidelines as string[];
    expect(guidelines.length).toBeGreaterThanOrEqual(1);
  });

  it("should return full document bodies when docs exist", async () => {
    vi.resetModules();
    writeDoc(
      "Resources",
      "dopamine-motivation",
      "Dopamine and Motivation",
      "## Summary\n\nDopamine plays a key role in reward-motivated behavior.\n\n## Key Points\n\n- Incentive salience\n- Reward prediction error",
      ["dopamine", "motivation"],
    );
    writeDoc(
      "Resources",
      "serotonin-mood",
      "Serotonin and Mood",
      "## Summary\n\nSerotonin regulates mood, appetite, and sleep.\n\n## Key Points\n\n- Mood regulation\n- Appetite control",
      ["serotonin", "mood"],
    );

    // Trigger DB build
    const { createDb, initDb, indexFile } =
      await import("../../../extensions/para-knowledge/db-sqlite.js");
    const dbPath = resolve(knowledgeDir, "notes.db");
    mkdirSync(knowledgeDir, { recursive: true });
    const db = createDb(dbPath);
    initDb(db);
    indexFile(db, {
      path: "Resources/dopamine-motivation.md",
      title: "Dopamine and Motivation",
      body: "## Summary\n\nDopamine plays a key role in reward-motivated behavior.\n\n## Key Points\n\n- Incentive salience\n- Reward prediction error",
      tags: ["dopamine", "motivation"],
      author: "test",
      editor: "",
      created: "2026-01-01T00:00:00.000Z",
      modified: "2026-01-01T00:00:00.000Z",
      file_mtime: "2026-01-01T00:00:00.000Z",
      source_url: null,
    });
    indexFile(db, {
      path: "Resources/serotonin-mood.md",
      title: "Serotonin and Mood",
      body: "## Summary\n\nSerotonin regulates mood, appetite, and sleep.\n\n## Key Points\n\n- Mood regulation\n- Appetite control",
      tags: ["serotonin", "mood"],
      author: "test",
      editor: "",
      created: "2026-01-01T00:00:00.000Z",
      modified: "2026-01-01T00:00:00.000Z",
      file_mtime: "2026-01-01T00:00:00.000Z",
      source_url: null,
    });
    db.close();

    vi.resetModules();
    const { registerAskTool } = await import("../../../extensions/commands/tools/ask.js");
    const registerTool = vi.fn();
    const mockPi = { registerTool, on: () => {} } as unknown as ExtensionAPI;
    registerAskTool(mockPi);
    const tool = getTool(registerTool);

    const result = await runAskTool(tool, "dopamine", projectDir);

    const details = result.details;
    expect(details.count).toBe(1);

    const content = result.content?.[0]?.text ?? "";
    // Should contain full document title
    expect(content).toContain("Dopamine and Motivation");
    // Should contain full document body
    expect(content).toContain("reward-motivated behavior");
    // Should contain the path
    expect(content).toContain("Resources/dopamine-motivation.md");
    // Should contain tags
    expect(content).toContain("dopamine");
    // Should NOT contain the non-matching document
    expect(content).not.toContain("Serotonin and Mood");
  });

  it("should auto-rebuild notes.db when missing and return results", async () => {
    vi.resetModules();
    // Write doc on disk — no notes.db yet
    writeDoc(
      "Resources",
      "ai-safety",
      "AI Safety",
      "## Summary\n\nAI safety research focuses on alignment and control.\n\n## Key Points\n\n- Alignment problem\n- Value learning",
      ["ai", "safety"],
    );

    vi.resetModules();
    const { registerAskTool } = await import("../../../extensions/commands/tools/ask.js");
    const registerTool = vi.fn();
    const mockPi = { registerTool, on: () => {} } as unknown as ExtensionAPI;
    registerAskTool(mockPi);
    const tool = getTool(registerTool);

    // notes.db should not exist before search
    expect(existsSync(resolve(knowledgeDir, "notes.db"))).toBe(false);

    const result = await runAskTool(tool, "AI safety alignment", projectDir);

    // notes.db should now exist after rebuild
    expect(existsSync(resolve(knowledgeDir, "notes.db"))).toBe(true);

    const details = result.details;
    expect(details.count).toBe(1);

    const content = result.content?.[0]?.text ?? "";
    expect(content).toContain("AI Safety");
    expect(content).toContain("Alignment problem");
  });

  it("should return empty results gracefully when nothing matches", async () => {
    vi.resetModules();
    const { registerAskTool } = await import("../../../extensions/commands/tools/ask.js");
    const registerTool = vi.fn();
    const mockPi = { registerTool, on: () => {} } as unknown as ExtensionAPI;
    registerAskTool(mockPi);
    const tool = getTool(registerTool);

    const result = await runAskTool(tool, "nonexistent topic", projectDir);

    const details = result.details;
    expect(details.count).toBe(0);

    const content = result.content?.[0]?.text ?? "";
    expect(content).toContain("No documents found");
  });

  it("should use KNOWLEDGE_DIR from project .pi/.env when env var is not set", async () => {
    // Create a separate knowledge dir with docs
    const envKnowledgeDir = join(tmpDir, "env-knowledge");
    mkdirSync(join(envKnowledgeDir, "Resources"), { recursive: true });
    writeFileSync(
      join(envKnowledgeDir, "Resources", "my-doc.md"),
      `---\ntitle: "My Doc"\ntags: [test]\n---\n\nBody with unique-search-term for ask tool test.`,
      "utf-8",
    );

    // Create .pi/.env in projectDir pointing to envKnowledgeDir
    const piEnvDir = join(projectDir, ".pi");
    mkdirSync(piEnvDir, { recursive: true });
    writeFileSync(join(piEnvDir, ".env"), `KNOWLEDGE_DIR=${envKnowledgeDir}\n`);

    // Unset KNOWLEDGE_DIR so it must come from .pi/.env via configureEnv
    delete process.env.KNOWLEDGE_DIR;

    vi.resetModules();
    const { registerAskTool } = await import("../../../extensions/commands/tools/ask.js");
    const registerTool = vi.fn();
    const mockPi = { registerTool, on: () => {} } as unknown as ExtensionAPI;
    registerAskTool(mockPi);
    const tool = getTool(registerTool);

    // notes.db should not exist before search
    expect(existsSync(resolve(envKnowledgeDir, "notes.db"))).toBe(false);

    const result = await runAskTool(tool, "unique-search-term", projectDir);

    // notes.db should now exist in envKnowledgeDir after rebuild
    expect(existsSync(resolve(envKnowledgeDir, "notes.db"))).toBe(true);

    const details = result.details;
    expect(details.count).toBe(1);

    // Cleanup
    rmSync(piEnvDir, { recursive: true, force: true });
    rmSync(envKnowledgeDir, { recursive: true, force: true });
  });
});
