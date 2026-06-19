/**
 * Tests for yaml-enforcer tools — verifies that validation/standardization
 * scans KNOWLEDGE_DIR rather than ctx.cwd.
 */

import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

function writeDoc(dir: string, area: string, slug: string, extraTags = ""): string {
  const content = `---
title: "${slug}"
author: pi
editor: lam
date: 2026-01-01T00:00:00.000Z
tags: [test]${extraTags}
---

Body of ${slug}.`;
  const areaDir = join(dir, area);
  mkdirSync(areaDir, { recursive: true });
  const filePath = join(areaDir, `${slug}.md`);
  writeFileSync(filePath, content, "utf-8");
  return filePath;
}

describe("yaml-enforcer validate_frontmatter", () => {
  let tmpDir: string;
  let knowledgeDir: string;
  let projectDir: string;
  let registeredTools: Record<string, unknown>[];

  beforeEach(() => {
    tmpDir = mkdtempSync(join(homedir(), "yamlEnforcer-test-"));
    knowledgeDir = join(tmpDir, "knowledge");
    projectDir = join(tmpDir, "project");
    mkdirSync(projectDir, { recursive: true });

    process.env.KNOWLEDGE_DIR = knowledgeDir;

    registeredTools = [];
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    delete process.env.KNOWLEDGE_DIR;
  });

  it("validate_frontmatter should scan KNOWLEDGE_DIR, not ctx.cwd", async () => {
    vi.resetModules();
    // Write a valid doc in KNOWLEDGE_DIR
    writeDoc(knowledgeDir, "Resources", "valid-doc");
    // Write an invalid doc (no frontmatter) in KNOWLEDGE_DIR
    mkdirSync(join(knowledgeDir, "Projects"), { recursive: true });
    writeFileSync(
      join(knowledgeDir, "Projects", "invalid-doc.md"),
      "This file has no frontmatter.\n",
      "utf-8",
    );

    // Write a doc in projectDir (should be ignored)
    writeDoc(projectDir, "Resources", "ignore-me");

    const mod = await import("../../extensions/yaml-enforcer/index.js");

    const mockPi = {
      registerTool: (tool: Record<string, unknown>) => {
        registeredTools.push(tool);
      },
      on: () => {},
    } as unknown as ExtensionAPI;

    mod.default(mockPi);

    // Find validate_frontmatter
    const validateTool = registeredTools.find((t) => t.name === "validate_frontmatter");
    expect(validateTool).toBeDefined();

    const execute = validateTool!.execute as (
      toolCallId: string,
      params: Record<string, unknown>,
      signal: AbortSignal | undefined,
      onUpdate: unknown,
      ctx: ExtensionContext,
    ) => Promise<{
      content: Array<{ type: string; text: string }>;
      details: Record<string, unknown>;
    }>;

    const result = await execute("call-1", {}, undefined, undefined, {
      cwd: projectDir,
    } as ExtensionContext);

    // Should find 2 files in KNOWLEDGE_DIR (1 valid, 1 invalid)
    // Should NOT find the file in projectDir
    const details = result.details;
    expect(details.scanned).toBe(2);

    // Should report at least 1 issue (the invalid frontmatter file)
    expect((details.issues as number) >= 1).toBe(true);
  });
});

describe("yaml-enforcer check_frontmatter", () => {
  let tmpDir: string;
  let knowledgeDir: string;
  let projectDir: string;
  let registeredTools: Record<string, unknown>[];
  let checkTool: Record<string, unknown> | undefined;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(homedir(), "yamlCheck-test-"));
    knowledgeDir = join(tmpDir, "knowledge");
    projectDir = join(tmpDir, "project");
    mkdirSync(projectDir, { recursive: true });

    process.env.KNOWLEDGE_DIR = knowledgeDir;

    registeredTools = [];
    checkTool = undefined;
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    delete process.env.KNOWLEDGE_DIR;
  });

  it("check_frontmatter should read from KNOWLEDGE_DIR, ignoring ctx.cwd", async () => {
    vi.resetModules();
    // Write doc ONLY in KNOWLEDGE_DIR (not in projectDir)
    const knowledgeDirPath = join(knowledgeDir, "Resources");
    mkdirSync(knowledgeDirPath, { recursive: true });
    const docContent = `---
title: "Check Test"
tags: [test]
---

Body content.`;
    writeFileSync(join(knowledgeDirPath, "check-target.md"), docContent, "utf-8");

    const mod = await import("../../extensions/yaml-enforcer/index.js");

    const mockPi = {
      registerTool: (tool: Record<string, unknown>) => {
        registeredTools.push(tool);
      },
      on: () => {},
    } as unknown as ExtensionAPI;

    mod.default(mockPi);

    checkTool = registeredTools.find((t) => t.name === "check_frontmatter");
    expect(checkTool).toBeDefined();

    const execute = checkTool!.execute as (
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
      { path: "Resources/check-target.md" },
      undefined,
      undefined,
      { cwd: projectDir } as ExtensionContext,
    );

    // Should succeed — file was found in KNOWLEDGE_DIR, not ctx.cwd
    const content = result.content?.[0]?.text ?? "";
    expect(content).toContain("**Resources/check-target.md**");
    expect(content).toContain("Frontmatter: Present");
    // Should NOT say "File not found" — that would mean it looked in cwd
    expect(content).not.toContain("Error");
  });
});

describe("yaml-enforcer standardize_frontmatter", () => {
  let tmpDir: string;
  let knowledgeDir: string;
  let projectDir: string;
  let registeredTools: Record<string, unknown>[];

  beforeEach(() => {
    tmpDir = mkdtempSync(join(homedir(), "yamlStd-test-"));
    knowledgeDir = join(tmpDir, "knowledge");
    projectDir = join(tmpDir, "project");
    mkdirSync(projectDir, { recursive: true });

    process.env.KNOWLEDGE_DIR = knowledgeDir;

    registeredTools = [];
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    delete process.env.KNOWLEDGE_DIR;
  });

  it("standardize_frontmatter should scan KNOWLEDGE_DIR, not ctx.cwd", async () => {
    vi.resetModules();
    // Write a doc with legacy field in KNOWLEDGE_DIR
    writeDoc(knowledgeDir, "Resources", "legacy-doc", '\nsource_url: "https://example.com"');
    // Write a doc with legacy field in projectDir (should be ignored)
    writeDoc(projectDir, "Resources", "project-legacy", '\nsource_url: "https://project.com"');

    const mod = await import("../../extensions/yaml-enforcer/index.js");

    const mockPi = {
      registerTool: (tool: Record<string, unknown>) => {
        registeredTools.push(tool);
      },
      on: () => {},
    } as unknown as ExtensionAPI;

    mod.default(mockPi);

    const stdTool = registeredTools.find((t) => t.name === "standardize_frontmatter");
    expect(stdTool).toBeDefined();

    const execute = stdTool!.execute as (
      toolCallId: string,
      params: Record<string, unknown>,
      signal: AbortSignal | undefined,
      onUpdate: unknown,
      ctx: ExtensionContext,
    ) => Promise<{
      content: Array<{ type: string; text: string }>;
      details: Record<string, unknown>;
    }>;

    const result = await execute("call-3", { dryRun: true }, undefined, undefined, {
      cwd: projectDir,
    } as ExtensionContext);

    // Should find 1 file with legacy field (in KNOWLEDGE_DIR), not the project one
    const details = result.details;
    expect(details.changed).toBe(1);
    expect((details.files as Array<Record<string, unknown>>)[0].file).toBe(
      "Resources/legacy-doc.md",
    );
  });
});
