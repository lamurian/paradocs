/**
 * Tests for the resolve_citation tool.
 *
 * resolve_citation is preview-only: it returns a citekey and BibTeX with
 * date/urldate fields but never writes ref.bib or notes.db.
 */

import { mkdtempSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

describe("resolve_citation preview", () => {
  let tmpDir: string;
  let knowledgeDir: string;
  let projectDir: string;
  let registeredTool: Record<string, unknown> | null;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(homedir(), "resolveCitation-test-"));
    knowledgeDir = join(tmpDir, "knowledge");
    projectDir = join(tmpDir, "project");
    mkdirSync(knowledgeDir, { recursive: true });
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

  it("returns a preview with date and urldate without writing ref.bib or notes.db", async () => {
    vi.resetModules();
    const { registerResolveCitationTool } =
      await import("../../extensions/para-knowledge/tools/resolveCitation.ts");

    const mockPi = {
      registerTool: (tool: Record<string, unknown>) => {
        registeredTool = tool;
      },
      on: () => {},
    } as unknown as ExtensionAPI;

    registerResolveCitationTool(mockPi);
    expect(registeredTool).not.toBeNull();

    const tool = registeredTool!;
    expect(String(tool.description)).toContain("never writes ref.bib or notes.db");

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
        source: "https://example.com/test-paper",
        title: "Test Paper about Something",
        authors: ["Smith, John"],
        year: 2024,
        accessed: "2024-08-01",
      },
      undefined,
      undefined,
      { cwd: projectDir } as ExtensionContext,
    );

    expect(result.details.citekey).toBe("smith2024");
    expect(result.details.isNew).toBe(true);
    expect(result.details.published).toBe("2024");
    expect(String(result.details.bibtex)).toContain("date = {2024}");
    expect(String(result.details.bibtex)).toContain("urldate = {2024-08-01}");
    expect(result.content[0].text).toContain("preview");

    expect(existsSync(resolve(knowledgeDir, "ref.bib"))).toBe(false);
    expect(existsSync(resolve(projectDir, "ref.bib"))).toBe(false);
    expect(existsSync(resolve(knowledgeDir, "notes.db"))).toBe(false);
  });
});
