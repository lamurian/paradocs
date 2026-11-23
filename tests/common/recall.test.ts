import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { DEFAULT_PARADOCS_CONFIG } from "../../common/config.ts";
import { runRecall, shouldSkipRecall } from "../../common/recall.ts";
import { indexFile } from "../../extensions/para-knowledge/sqlite-indexing.ts";
import { createDb, initDb } from "../../extensions/para-knowledge/sqlite-init.ts";

import type { ParadocsConfig } from "../../common/config.ts";
import type { DocIndex, SqliteDb } from "../../extensions/para-knowledge/sqlite-types.ts";

/** Build an indexed note with deterministic freshness metadata. */
function makeDoc(overrides: Partial<DocIndex> = {}): DocIndex {
  return {
    path: "Projects/note.md",
    title: "TypeScript Database Reasoning",
    body: "typescript database reasoning orchestration",
    tags: [],
    author: "pi",
    editor: "lam",
    created: "2026-01-01T00:00:00.000Z",
    modified: "2026-01-01T00:00:00.000Z",
    file_mtime: "2026-01-01T00:00:00.000Z",
    source_url: null,
    reviewed: "2026-01-01",
    ...overrides,
  };
}

/** Clone the default config so each test can tweak recall settings. */
function makeConfig(recall: Partial<ParadocsConfig["recall"]> = {}): ParadocsConfig {
  return {
    freshness: { ...DEFAULT_PARADOCS_CONFIG.freshness },
    recall: { ...DEFAULT_PARADOCS_CONFIG.recall, ...recall },
    note: { ...DEFAULT_PARADOCS_CONFIG.note },
    relevance: { ...DEFAULT_PARADOCS_CONFIG.relevance },
  };
}

describe("shouldSkipRecall", () => {
  it("skips slash commands but allows /discuss", () => {
    const config = makeConfig().recall;

    expect(shouldSkipRecall("/help me with database", config)).toBe(true);
    expect(shouldSkipRecall("/discuss database reasoning", config)).toBe(false);
    expect(shouldSkipRecall("plain prompt", config)).toBe(false);
  });

  it("skips prompts matching any skip pattern", () => {
    const config = makeConfig({ skipPatterns: ["^scratch/", "secret"] }).recall;

    expect(shouldSkipRecall("scratch/notes", config)).toBe(true);
    expect(shouldSkipRecall("a secret plan", config)).toBe(true);
    expect(shouldSkipRecall("regular prompt", config)).toBe(false);
  });

  it("ignores invalid regular expressions", () => {
    const config = makeConfig({ skipPatterns: ["[unterminated"] }).recall;

    expect(shouldSkipRecall("regular prompt", config)).toBe(false);
  });
});

describe("runRecall", () => {
  let db: SqliteDb;

  beforeEach(() => {
    db = createDb(":memory:");
    initDb(db);
  });

  afterEach(() => {
    db?.close();
  });

  it("returns a block of qualifying hits with title, path, freshness and description", () => {
    indexFile(
      db,
      makeDoc({
        path: "Projects/alpha.md",
        title: "TypeScript Database Reasoning",
        description: "A guide to orchestration",
      }),
    );
    indexFile(
      db,
      makeDoc({
        path: "Projects/beta.md",
        title: "TypeScript Basics",
        body: "typescript only",
        description: "Unrelated",
      }),
    );
    indexFile(
      db,
      makeDoc({
        path: "Projects/gamma.md",
        title: "Cooking",
        body: "pasta recipe",
        description: "Food",
      }),
    );

    const result = runRecall(
      "typescript database reasoning",
      db,
      makeConfig(),
      new Date("2026-01-10T00:00:00.000Z"),
    );

    expect(result).not.toBeNull();
    expect(result?.hits).toBe(1);
    expect(result?.block).toContain("KB recall (paradocs): existing notes related to this prompt");
    expect(result?.block).toContain(
      "- TypeScript Database Reasoning | Projects/alpha.md | freshness: fresh | A guide to orchestration",
    );
    expect(result?.block).not.toContain("Projects/beta.md");
  });

  it("caps the block at 3 notes by default", () => {
    for (let i = 0; i < 6; i++) {
      indexFile(
        db,
        makeDoc({
          path: `Projects/note-${i}.md`,
          title: `TypeScript Database Reasoning ${i}`,
        }),
      );
    }

    const result = runRecall(
      "typescript database reasoning orchestration",
      db,
      makeConfig(),
      new Date("2026-01-10T00:00:00.000Z"),
    );

    expect(result?.hits).toBe(3);
    expect(result?.block.split("\n")).toHaveLength(4);
  });

  it("drops notes scoring below relativeCut x the best note", () => {
    for (let i = 0; i < 2; i++) {
      indexFile(
        db,
        makeDoc({
          path: `Projects/best-${i}.md`,
          title: "TypeScript Database Reasoning",
          body: "",
        }),
      );
    }
    indexFile(
      db,
      makeDoc({
        path: "Projects/weak.md",
        title: "TypeScript Database",
        body: "reasoning",
        description: "",
      }),
    );

    const result = runRecall(
      "typescript database reasoning",
      db,
      makeConfig(),
      new Date("2026-01-10T00:00:00.000Z"),
    );

    expect(result?.hits).toBe(2);
    expect(result?.block).not.toContain("Projects/weak.md");
  });

  it("returns null when the best coverage is below kbThreshold despite sharing two terms", () => {
    indexFile(
      db,
      makeDoc({
        path: "Projects/thin.md",
        title: "TypeScript Database",
        body: "",
        description: "",
      }),
    );
    indexFile(
      db,
      makeDoc({
        path: "Projects/decoy.md",
        title: "Unrelated",
        body: "typescript database reasoning",
      }),
    );

    const result = runRecall(
      "typescript database reasoning",
      db,
      makeConfig(),
      new Date("2026-01-10T00:00:00.000Z"),
    );

    expect(result).toBeNull();
  });

  it("matches whole tokens only so 'digital' does not match the term 'git'", () => {
    indexFile(
      db,
      makeDoc({
        path: "Projects/digital.md",
        title: "Digital caching conflicts",
        body: "",
        description: "",
      }),
    );
    indexFile(
      db,
      makeDoc({
        path: "Projects/git.md",
        title: "Git caching conflicts",
        body: "",
        description: "",
      }),
    );

    const result = runRecall(
      "git caching conflicts",
      db,
      makeConfig(),
      new Date("2026-01-10T00:00:00.000Z"),
    );

    expect(result).not.toBeNull();
    expect(result?.block).toContain("Projects/git.md");
    expect(result?.block).not.toContain("Projects/digital.md");
  });

  it("returns null when fewer than three terms are kept", () => {
    indexFile(db, makeDoc());

    expect(
      runRecall("typescript database", db, makeConfig(), new Date("2026-01-10T00:00:00.000Z")),
    ).toBeNull();
  });

  it("returns null for slash commands other than /discuss", () => {
    indexFile(db, makeDoc());

    expect(
      runRecall(
        "/help typescript database",
        db,
        makeConfig(),
        new Date("2026-01-10T00:00:00.000Z"),
      ),
    ).toBeNull();
  });

  it("runs for /discuss prompts", () => {
    indexFile(db, makeDoc());

    const result = runRecall(
      "/discuss typescript database reasoning",
      db,
      makeConfig(),
      new Date("2026-01-10T00:00:00.000Z"),
    );

    expect(result?.hits).toBe(1);
  });

  it("returns null for prompts matching a skip pattern", () => {
    indexFile(db, makeDoc());

    const result = runRecall(
      "scratch typescript database reasoning",
      db,
      makeConfig({ skipPatterns: ["^scratch"] }),
      new Date("2026-01-10T00:00:00.000Z"),
    );

    expect(result).toBeNull();
  });

  it("accepts a recall-only config and an epoch timestamp for now", () => {
    indexFile(db, makeDoc());

    const result = runRecall(
      "typescript database reasoning",
      db,
      makeConfig().recall,
      new Date("2026-01-10T00:00:00.000Z").getTime(),
    );

    expect(result?.hits).toBe(1);
  });
});
