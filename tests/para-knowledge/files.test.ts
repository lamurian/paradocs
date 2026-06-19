import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

import { describe, it, expect, beforeEach, afterEach } from "vitest";

function createTempDir(): string {
  const tmp = mkdtempSync(join(homedir(), "files-test-"));
  // Create PARA directory structure
  mkdirSync(join(tmp, "Areas"), { recursive: true });
  mkdirSync(join(tmp, "Projects"), { recursive: true });
  mkdirSync(join(tmp, "Resources"), { recursive: true });
  return tmp;
}

function writeMarkdown(
  dir: string,
  subdir: string,
  name: string,
  frontmatter: string,
  body: string,
): string {
  const absDir = join(dir, subdir);
  mkdirSync(absDir, { recursive: true });
  const filePath = join(absDir, name);
  writeFileSync(filePath, `---\n${frontmatter}\n---\n\n${body}`, "utf-8");
  return filePath;
}

describe("slugify", () => {
  it("should convert title to lowercase kebab-case", async () => {
    const { slugify } = await import("../../extensions/para-knowledge/files.js");
    expect(slugify("Hello World")).toBe("hello-world");
  });

  it("should collapse multiple non-alphanumeric characters", async () => {
    const { slugify } = await import("../../extensions/para-knowledge/files.js");
    expect(slugify("Hello   World!!! Test")).toBe("hello-world-test");
  });

  it("should strip leading and trailing hyphens", async () => {
    const { slugify } = await import("../../extensions/para-knowledge/files.js");
    expect(slugify("  --Hello World--  ")).toBe("hello-world");
  });

  it("should handle empty string", async () => {
    const { slugify } = await import("../../extensions/para-knowledge/files.js");
    expect(slugify("")).toBe("");
  });

  it("should handle special characters", async () => {
    const { slugify } = await import("../../extensions/para-knowledge/files.js");
    expect(slugify("TypeScript & JavaScript: A Guide")).toBe("typescript-javascript-a-guide");
  });
});

describe("scanParaDir", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = createTempDir();
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("should return .md files in the given PARA directory", async () => {
    const { scanParaDir } = await import("../../extensions/para-knowledge/files.js");
    writeMarkdown(tmpDir, "Areas", "doc1.md", "title: Doc 1", "Body 1");
    writeMarkdown(tmpDir, "Areas", "doc2.md", "title: Doc 2", "Body 2");

    const entries = await scanParaDir("Areas", tmpDir);
    expect(entries.length).toBe(2);
    const paths = entries.map((e) => e.path).sort();
    expect(paths).toEqual(["Areas/doc1.md", "Areas/doc2.md"]);
  });

  it("should skip non-.md files", async () => {
    const { scanParaDir } = await import("../../extensions/para-knowledge/files.js");
    writeMarkdown(tmpDir, "Resources", "notes.md", "title: Notes", "Body");
    writeFileSync(join(tmpDir, "Resources", "image.png"), "fake-png", "utf-8");
    writeFileSync(join(tmpDir, "Resources", "data.json"), "{}", "utf-8");

    const entries = await scanParaDir("Resources", tmpDir);
    expect(entries.length).toBe(1);
    expect(entries[0].path).toBe("Resources/notes.md");
  });

  it("should return mtimeMs for each file", async () => {
    const { scanParaDir } = await import("../../extensions/para-knowledge/files.js");
    writeMarkdown(tmpDir, "Areas", "doc.md", "title: Test", "Body");

    const entries = await scanParaDir("Areas", tmpDir);
    expect(entries.length).toBe(1);
    expect(entries[0].mtimeMs).toBeGreaterThan(0);
  });

  it("should return absolute path for each file", async () => {
    const { scanParaDir } = await import("../../extensions/para-knowledge/files.js");
    writeMarkdown(tmpDir, "Projects", "doc.md", "title: Test", "Body");

    const entries = await scanParaDir("Projects", tmpDir);
    expect(entries.length).toBe(1);
    expect(entries[0].absPath).toBe(resolve(tmpDir, "Projects", "doc.md"));
  });

  it("should return empty array for non-existent directory", async () => {
    const { scanParaDir } = await import("../../extensions/para-knowledge/files.js");
    const entries = await scanParaDir("Nonexistent", tmpDir);
    expect(entries).toEqual([]);
  });
});

describe("scanAllParaDirs", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = createTempDir();
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("should scan all three PARA directories", async () => {
    const { scanAllParaDirs } = await import("../../extensions/para-knowledge/files.js");
    writeMarkdown(tmpDir, "Areas", "a.md", "title: A", "Body A");
    writeMarkdown(tmpDir, "Projects", "p.md", "title: P", "Body P");
    writeMarkdown(tmpDir, "Resources", "r.md", "title: R", "Body R");

    const entries = await scanAllParaDirs(tmpDir);
    expect(entries.length).toBe(3);
    const paths = entries.map((e) => e.path).sort();
    expect(paths).toEqual(["Areas/a.md", "Projects/p.md", "Resources/r.md"]);
  });

  it("should return empty array when no PARA dirs have files", async () => {
    const { scanAllParaDirs } = await import("../../extensions/para-knowledge/files.js");
    const entries = await scanAllParaDirs(tmpDir);
    expect(entries).toEqual([]);
  });
});

describe("parseFile", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = createTempDir();
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("should parse title and body from a markdown file", async () => {
    const { scanParaDir, parseFile } = await import("../../extensions/para-knowledge/files.js");
    writeMarkdown(
      tmpDir,
      "Projects",
      "mydoc.md",
      "title: My Document\nauthor: Alice",
      "Hello world body.",
    );

    const entries = await scanParaDir("Projects", tmpDir);
    const parsed = await parseFile(entries[0]);
    expect(parsed.title).toBe("My Document");
    expect(parsed.body).toBe("Hello world body.");
    expect(parsed.author).toBe("Alice");
  });

  it("should parse tags from frontmatter", async () => {
    const { scanParaDir, parseFile } = await import("../../extensions/para-knowledge/files.js");
    writeMarkdown(
      tmpDir,
      "Areas",
      "tagged.md",
      "title: Tagged\ntags:\n  - foo\n  - bar",
      "Tagged body.",
    );

    const entries = await scanParaDir("Areas", tmpDir);
    const parsed = await parseFile(entries[0]);
    expect(parsed.tags).toEqual(["foo", "bar"]);
  });

  it("should extract description from frontmatter", async () => {
    const { scanParaDir, parseFile } = await import("../../extensions/para-knowledge/files.js");
    writeMarkdown(
      tmpDir,
      "Resources",
      "desc.md",
      "title: With Desc\ndescription: A short description",
      "Body text.",
    );

    const entries = await scanParaDir("Resources", tmpDir);
    const parsed = await parseFile(entries[0]);
    expect(parsed.description).toBe("A short description");
  });

  it("should extract source_url from frontmatter", async () => {
    const { scanParaDir, parseFile } = await import("../../extensions/para-knowledge/files.js");
    writeMarkdown(
      tmpDir,
      "Projects",
      "sourced.md",
      "title: Sourced\nsource_url: https://example.com",
      "Body.",
    );

    const entries = await scanParaDir("Projects", tmpDir);
    const parsed = await parseFile(entries[0]);
    expect(parsed.source_url).toBe("https://example.com");
  });

  it("should fall back to filename for title when no frontmatter title", async () => {
    const { scanParaDir, parseFile } = await import("../../extensions/para-knowledge/files.js");
    writeMarkdown(tmpDir, "Areas", "my-fallback-doc.md", "", "Body only.");

    const entries = await scanParaDir("Areas", tmpDir);
    const parsed = await parseFile(entries[0]);
    expect(parsed.title).toBe("my-fallback-doc");
  });

  it("should handle file with no frontmatter at all", async () => {
    const { scanParaDir, parseFile } = await import("../../extensions/para-knowledge/files.js");
    writeFileSync(join(tmpDir, "Areas", "plain.md"), "Just body text\nNo frontmatter.", "utf-8");

    const entries = await scanParaDir("Areas", tmpDir);
    const parsed = await parseFile(entries[0]);
    expect(parsed.title).toBe("plain");
    expect(parsed.body).toBe("Just body text\nNo frontmatter.");
    expect(parsed.tags).toEqual([]);
  });

  it("should handle editor and created fields", async () => {
    const { scanParaDir, parseFile } = await import("../../extensions/para-knowledge/files.js");
    writeMarkdown(
      tmpDir,
      "Resources",
      "metadata.md",
      "title: Metadata\nauthor: Alice\neditor: Bob\ndate: 2026-06-01",
      "Metadata body.",
    );

    const entries = await scanParaDir("Resources", tmpDir);
    const parsed = await parseFile(entries[0]);
    expect(parsed.author).toBe("Alice");
    expect(parsed.editor).toBe("Bob");
    expect(parsed.created).toBe("2026-06-01");
  });

  it("should handle empty body gracefully", async () => {
    const { scanParaDir, parseFile } = await import("../../extensions/para-knowledge/files.js");
    writeMarkdown(tmpDir, "Projects", "empty.md", "title: Empty Doc", "");

    const entries = await scanParaDir("Projects", tmpDir);
    const parsed = await parseFile(entries[0]);
    expect(parsed.title).toBe("Empty Doc");
    expect(parsed.body).toBe("");
  });
});
