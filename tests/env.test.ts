import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// expandTilde
// ---------------------------------------------------------------------------

describe("expandTilde", () => {
  it("should expand ~ to homedir", async () => {
    const { expandTilde } = await import("../common/env.js");
    expect(expandTilde("~/foo/bar")).toBe(join(homedir(), "foo", "bar"));
  });

  it("should leave non-tilde paths unchanged", async () => {
    const { expandTilde } = await import("../common/env.js");
    expect(expandTilde("/foo/bar")).toBe("/foo/bar");
  });

  it("should handle just ~", async () => {
    const { expandTilde } = await import("../common/env.js");
    expect(expandTilde("~")).toBe(homedir());
  });

  it("should handle ~user as homedir (not supported, treat as literal)", async () => {
    const { expandTilde } = await import("../common/env.js");
    // ~user expansion is not supported; leave as-is
    expect(expandTilde("~user/foo")).toBe("~user/foo");
  });
});

// ---------------------------------------------------------------------------
// configureEnv — three-layer cascade
//
// We test using the options parameter which allows overriding the global env
// path so we don't need to mock os.homedir() (which is tricky in ESM).
// ---------------------------------------------------------------------------

describe("configureEnv", () => {
  let tmpDir: string;
  let globalEnvDir: string;
  let projectDir: string;
  let globalEnvPath: string;
  let projectEnvPath: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(homedir(), "env-test-"));
    globalEnvDir = join(tmpDir, "global", ".pi", "agent");
    projectDir = join(tmpDir, "project");
    globalEnvPath = join(globalEnvDir, ".env");
    projectEnvPath = join(projectDir, ".pi", ".env");
    mkdirSync(globalEnvDir, { recursive: true });
    mkdirSync(join(projectDir, ".pi"), { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    // Clean up env vars we may have set
    delete process.env.SEARXNG_PORT;
    delete process.env.MY_VAR;
    delete process.env.FIRST;
    delete process.env.SECOND;
  });

  it("should set default values when no .env files exist", async () => {
    vi.resetModules();
    const { configureEnv } = await import("../common/env.js");
    configureEnv(projectDir, {
      globalEnvPath,
      projectEnvPath,
    });

    expect(process.env.SEARXNG_PORT).toBe("8888");
  });

  it("should load global .env over defaults", async () => {
    vi.resetModules();
    writeFileSync(globalEnvPath, "SEARXNG_PORT=9999\n");

    const { configureEnv } = await import("../common/env.js");
    configureEnv(projectDir, { globalEnvPath, projectEnvPath });

    expect(process.env.SEARXNG_PORT).toBe("9999");
  });

  it("should load project .env over global", async () => {
    vi.resetModules();
    writeFileSync(globalEnvPath, "SEARXNG_PORT=9999\nMY_VAR=global\n");
    writeFileSync(projectEnvPath, "SEARXNG_PORT=7777\n");

    const { configureEnv } = await import("../common/env.js");
    configureEnv(projectDir, { globalEnvPath, projectEnvPath });

    expect(process.env.SEARXNG_PORT).toBe("7777");
    // MY_VAR not overridden by project, should still be global
    expect(process.env.MY_VAR).toBe("global");
  });

  it("should be a lazy singleton — second call is no-op", async () => {
    vi.resetModules();
    writeFileSync(globalEnvPath, "FIRST=loaded\n");

    const mod = await import("../common/env.js");
    mod.configureEnv(projectDir, { globalEnvPath, projectEnvPath });
    expect(process.env.FIRST).toBe("loaded");

    // Change the file AFTER first load
    writeFileSync(globalEnvPath, "SECOND=also-loaded\n");

    // Second call — should be no-op
    mod.configureEnv(projectDir, { globalEnvPath, projectEnvPath });
    expect(process.env.SECOND).toBeUndefined();
  });

  it("should work without cwd (no project layer)", async () => {
    vi.resetModules();
    writeFileSync(globalEnvPath, "SEARXNG_PORT=5555\n");

    const { configureEnv } = await import("../common/env.js");
    configureEnv(undefined, { globalEnvPath }); // no cwd, only global

    expect(process.env.SEARXNG_PORT).toBe("5555");
  });

  it("should not load project env when no cwd given", async () => {
    vi.resetModules();
    writeFileSync(globalEnvPath, "SEARXNG_PORT=5555\n");
    writeFileSync(projectEnvPath, "SEARXNG_PORT=3333\n");

    const { configureEnv } = await import("../common/env.js");
    configureEnv(undefined, { globalEnvPath }); // no cwd

    // Project env should NOT be loaded since no cwd
    expect(process.env.SEARXNG_PORT).toBe("5555");
  });

  it("should not fail when global .env does not exist", async () => {
    vi.resetModules();
    // Don't create any .env files

    const { configureEnv } = await import("../common/env.js");
    expect(() =>
      configureEnv(projectDir, {
        globalEnvPath: join(tmpDir, "nonexistent", ".env"),
        projectEnvPath,
      }),
    ).not.toThrow();
  });

  it("should not fail when project .env does not exist", async () => {
    vi.resetModules();
    // Don't create project .env

    const { configureEnv } = await import("../common/env.js");
    expect(() =>
      configureEnv(projectDir, {
        globalEnvPath,
        projectEnvPath: join(projectDir, "nonexistent", ".env"),
      }),
    ).not.toThrow();
  });

  it("should fall back to default env paths when options omitted (covers ?? branch)", async () => {
    vi.resetModules();
    // Don't create any actual .env files at default paths

    const { configureEnv } = await import("../common/env.js");
    // Without options, configureEnv resolves default paths using homedir() and cwd.
    // These paths won't exist, so the function should silently skip them.
    expect(() => configureEnv(projectDir)).not.toThrow();
  });

  it("should handle configureEnv without cwd and without options", async () => {
    vi.resetModules();
    const { configureEnv } = await import("../common/env.js");
    // No cwd, no options — only defaults applied
    expect(() => configureEnv()).not.toThrow();
    expect(process.env.SEARXNG_PORT).toBe("8888");
  });
});

// ---------------------------------------------------------------------------
// getKnowledgeConfig — cwd fallback
// ---------------------------------------------------------------------------

describe("getKnowledgeConfig", () => {
  afterEach(() => {
    delete process.env.KNOWLEDGE_DIR;
    delete process.env.KNOWLEDGE_DB;
  });

  it("should return KNOWLEDGE_DIR when set", async () => {
    vi.resetModules();
    process.env.KNOWLEDGE_DIR = "/custom/knowledge";
    const { getKnowledgeConfig } = await import("../common/env.js");
    const config = getKnowledgeConfig("/fallback/cwd");
    expect(config.dir).toBe("/custom/knowledge");
  });

  it("should fall back to cwd when KNOWLEDGE_DIR is unset", async () => {
    vi.resetModules();
    delete process.env.KNOWLEDGE_DIR;
    const { getKnowledgeConfig } = await import("../common/env.js");
    const config = getKnowledgeConfig("/my/project");
    expect(config.dir).toBe("/my/project");
  });

  it("should fall back to default when neither KNOWLEDGE_DIR nor cwd is set", async () => {
    vi.resetModules();
    delete process.env.KNOWLEDGE_DIR;
    const { getKnowledgeConfig } = await import("../common/env.js");
    const config = getKnowledgeConfig();
    expect(config.dir).toBe(resolve(homedir(), "data/personal/Documents/Cognoscere"));
  });

  it("should preserve KNOWLEDGE_DB across all fallback modes", async () => {
    vi.resetModules();
    delete process.env.KNOWLEDGE_DIR;
    const { getKnowledgeConfig } = await import("../common/env.js");

    // Without cwd
    let config = getKnowledgeConfig();
    expect(config.db).toBe("notes.db");

    // With cwd
    config = getKnowledgeConfig("/some/cwd");
    expect(config.db).toBe("notes.db");

    // With env override
    process.env.KNOWLEDGE_DB = "custom.db";
    config = getKnowledgeConfig("/some/cwd");
    expect(config.db).toBe("custom.db");
  });

  it("should expand tilde in KNOWLEDGE_DIR", async () => {
    vi.resetModules();
    process.env.KNOWLEDGE_DIR = "~/my-knowledge";
    const { getKnowledgeConfig } = await import("../common/env.js");
    const config = getKnowledgeConfig();
    expect(config.dir).toBe(resolve(homedir(), "my-knowledge"));
  });

  it("should use cwd as-is without tilde expansion", async () => {
    vi.resetModules();
    delete process.env.KNOWLEDGE_DIR;
    const { getKnowledgeConfig } = await import("../common/env.js");
    const config = getKnowledgeConfig("./relative/path");
    // cwd is used as-is, no tilde expansion applied
    expect(config.dir).toBe("./relative/path");
  });
});
