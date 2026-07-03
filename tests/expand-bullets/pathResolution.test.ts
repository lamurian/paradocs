/**
 * Tests for expand_bullet_points — verifies that document reads happen
 * from KNOWLEDGE_DIR rather than ctx.cwd.
 */

import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:os")>();
  return {
    ...actual,
    homedir: vi.fn(),
  };
});

describe("expand_bullet_points path resolution", () => {
  let tmpDir: string;
  let fakeHome: string;
  let knowledgeDir: string;
  let projectDir: string;
  let registeredTool: Record<string, unknown> | null;

  beforeEach(() => {
    tmpDir = mkdtempSync("/tmp/expandBullets-test-");
    fakeHome = join(tmpDir, "fake-home");
    mkdirSync(fakeHome, { recursive: true });
    vi.mocked(homedir).mockReturnValue(fakeHome);

    knowledgeDir = join(tmpDir, "knowledge");
    projectDir = join(tmpDir, "project");
    mkdirSync(projectDir, { recursive: true });

    process.env.KNOWLEDGE_DIR = knowledgeDir;
    process.env.TAVILY_KEY = "test-key";

    registeredTool = null;
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    delete process.env.KNOWLEDGE_DIR;
    delete process.env.TAVILY_KEY;
  });

  it("should read document from KNOWLEDGE_DIR, not ctx.cwd", async () => {
    vi.resetModules();
    // Create a doc in KNOWLEDGE_DIR
    const resourcesDir = join(knowledgeDir, "Resources");
    mkdirSync(resourcesDir, { recursive: true });
    writeFileSync(
      join(resourcesDir, "test-bullets.md"),
      `---
title: "Bullet Test"
tags: [test]
---

- bullet one
- bullet two`,
      "utf-8",
    );

    const mod = await import("../../extensions/expand-bullets/index.js");

    const mockPi = {
      registerTool: (tool: Record<string, unknown>) => {
        registeredTool = tool;
      },
      on: () => {},
      exec: () => Promise.resolve({ code: 1, stdout: "" }),
    } as unknown as ExtensionAPI;

    mod.default(mockPi);
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

    // Point docPath at the knowledge dir path relative to KNOWLEDGE_DIR
    const result = await execute(
      "call-1",
      {
        docPath: "Resources/test-bullets.md",
      },
      undefined,
      undefined,
      { cwd: projectDir } as ExtensionContext,
    );

    // If it read from KNOWLEDGE_DIR, it'll find the doc and report bullets
    const content = result.content?.[0]?.text ?? "";
    expect(content).toContain("bullet one");
    expect(content).toContain("bullet two");
  });

  it("should fall back to default when KNOWLEDGE_DIR is not set, ignoring cwd", async () => {
    vi.resetModules();
    delete process.env.KNOWLEDGE_DIR;

    // Create a doc in the default Cognoscere location
    const defaultDir = join(fakeHome, "data", "personal", "Documents", "Cognoscere");
    const resourcesDir = join(defaultDir, "Resources");
    mkdirSync(resourcesDir, { recursive: true });
    writeFileSync(
      join(resourcesDir, "default-bullets.md"),
      `---
title: "Default Bullets"
tags: [test]
---

- point a
- point b`,
      "utf-8",
    );

    const mod = await import("../../extensions/expand-bullets/index.js");

    const mockPi = {
      registerTool: (tool: Record<string, unknown>) => {
        registeredTool = tool;
      },
      on: () => {},
      exec: () => Promise.resolve({ code: 1, stdout: "" }),
    } as unknown as ExtensionAPI;

    mod.default(mockPi);

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
        docPath: "Resources/default-bullets.md",
      },
      undefined,
      undefined,
      { cwd: projectDir } as ExtensionContext,
    );

    const content = result.content?.[0]?.text ?? "";
    expect(content).toContain("point a");
    expect(content).toContain("point b");
  });
});
