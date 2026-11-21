/**
 * Tests for extensions/para-outbox — stage_para_docs staging behaviour.
 *
 * Covers create and update batches plus the all-or-nothing validation rule.
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { sha256File } from "../../common/outbox.ts";

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

interface ToolResult {
  content: Array<{ type: string; text: string }>;
  details: {
    ok: boolean;
    batchId: string | null;
    dir: string | null;
    errors: string[];
  };
}

interface RegisteredTool {
  name: string;
  execute: (
    toolCallId: string,
    params: Record<string, unknown>,
    signal: AbortSignal | undefined,
    onUpdate: unknown,
    ctx: ExtensionContext,
  ) => Promise<ToolResult>;
}

/** Minimal valid staged note params. */
function validNote(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    mode: "create",
    title: "Outbox Test Note",
    description: "A staged note",
    tags: ["testing"],
    area: "Resources",
    summary: ["A summary paragraph."],
    keyPoints: ["A key point."],
    ...overrides,
  };
}

describe("stage_para_docs", () => {
  let tmpDir: string;
  let cwd: string;
  let knowledgeDir: string;
  let tool: RegisteredTool;

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "stage-tool-test-"));
    cwd = join(tmpDir, "project");
    knowledgeDir = join(tmpDir, "knowledge");
    mkdirSync(cwd, { recursive: true });
    mkdirSync(knowledgeDir, { recursive: true });
    process.env.KNOWLEDGE_DIR = knowledgeDir;
    process.env.KNOWLEDGE_DB = "notes.db";

    const { registerStageTool } = await import("../../extensions/para-outbox/stage-tool.ts");
    let registered: RegisteredTool | null = null;
    const fakePi = {
      registerTool: (candidate: RegisteredTool) => {
        registered = candidate;
      },
    } as unknown as ExtensionAPI;
    registerStageTool(fakePi);
    expect(registered).not.toBeNull();
    tool = registered as unknown as RegisteredTool;
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    delete process.env.KNOWLEDGE_DIR;
    delete process.env.KNOWLEDGE_DB;
  });

  /** Execute the tool against the project cwd. */
  async function run(params: Record<string, unknown>): Promise<ToolResult> {
    return tool.execute("call-1", params, undefined, undefined, {
      cwd,
    } as unknown as ExtensionContext);
  }

  it("writes rendered notes, citations and a manifest and returns the batch id", async () => {
    const result = await run({
      notes: [validNote()],
      citations: [{ citekey: "smith2024", bibtex: "@misc{smith2024, title={Test}}" }],
    });

    expect(result.details.ok).toBe(true);
    expect(result.details.batchId).toMatch(/^b-[a-z0-9]+-[a-z0-9]{6}$/);

    const batchDir = join(cwd, ".pi", "paradocs", "outbox", result.details.batchId as string);
    expect(result.details.dir).toBe(batchDir);

    const noteFile = join(batchDir, "notes", "outbox-test-note.md");
    expect(existsSync(noteFile)).toBe(true);
    const markdown = readFileSync(noteFile, "utf8");
    expect(markdown).toContain("## Summary");
    expect(markdown).toContain("## Key Points");

    const citations = JSON.parse(
      readFileSync(join(batchDir, "citations.json"), "utf8"),
    ) as unknown[];
    expect(citations).toEqual([{ citekey: "smith2024", bibtex: "@misc{smith2024, title={Test}}" }]);

    const manifest = JSON.parse(readFileSync(join(batchDir, "manifest.json"), "utf8")) as {
      batchId: string;
      notes: { targetPath: string; mode: string; baseHash: string | null }[];
    };
    expect(manifest.batchId).toBe(result.details.batchId);
    expect(manifest.notes[0]).toMatchObject({
      mode: "create",
      targetPath: "Resources/outbox-test-note.md",
      baseHash: null,
    });
  });

  it("records the target path and the current KB file sha256 as baseHash for updates", async () => {
    const targetPath = "Resources/existing-note.md";
    const targetAbs = join(knowledgeDir, targetPath);
    mkdirSync(join(knowledgeDir, "Resources"), { recursive: true });
    writeFileSync(targetAbs, "old body\n");

    const result = await run({
      notes: [validNote({ mode: "update", targetPath, title: "Existing Note" })],
    });

    expect(result.details.ok).toBe(true);
    const batchDir = result.details.dir as string;
    const manifest = JSON.parse(readFileSync(join(batchDir, "manifest.json"), "utf8")) as {
      notes: { targetPath: string; mode: string; baseHash: string | null }[];
    };

    expect(manifest.notes[0]).toMatchObject({
      mode: "update",
      targetPath,
      baseHash: sha256File(targetAbs),
    });
  });

  it("writes nothing and returns every error prefixed with its note title", async () => {
    const result = await run({
      notes: [
        validNote({ title: "Broken Note", description: "" }),
        validNote({ title: "Bad Tags Note", tags: ["Not Kebab"] }),
      ],
    });

    expect(result.details.ok).toBe(false);
    expect(result.details.batchId).toBeNull();
    expect(result.details.errors).toContain("Broken Note: description is required");
    expect(result.details.errors).toContain("Bad Tags Note: tags must be 1-10 kebab-case values");
    expect(existsSync(join(cwd, ".pi", "paradocs"))).toBe(false);
  });
});

describe("para-outbox extension registration", () => {
  it("registers stage_para_docs", async () => {
    const { default: paraOutbox } = await import("../../extensions/para-outbox/index.ts");
    const registered: string[] = [];
    const fakePi = {
      registerTool: (candidate: { name: string }) => {
        registered.push(candidate.name);
      },
    } as unknown as ExtensionAPI;

    paraOutbox(fakePi);

    expect(registered).toEqual(["stage_para_docs"]);
  });
});
