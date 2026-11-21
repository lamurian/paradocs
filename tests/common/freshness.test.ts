import { describe, expect, it } from "vitest";

import {
  computeFreshness,
  loadFreshness,
  resolveWindowDays,
  type FreshnessInput,
} from "../../common/freshness.ts";
import { indexFile } from "../../extensions/para-knowledge/sqlite-indexing.ts";
import { createDb, initDb } from "../../extensions/para-knowledge/sqlite-init.ts";

import type { FreshnessConfig } from "../../common/config.ts";
import type { SqliteDb, DocIndex } from "../../extensions/para-knowledge/sqlite-types.ts";

const CONFIG: FreshnessConfig = {
  defaultWindowDays: 365,
  tagWindows: { rust: null, legacy: 30, quick: 10, slower: 60 },
};

const NOW = new Date("2026-01-01T00:00:00.000Z");

/** Build freshness input with no dates unless overridden. */
function input(overrides: Partial<FreshnessInput> = {}): FreshnessInput {
  return {
    tags: [],
    reviewed: null,
    reviewInterval: null,
    noteModified: null,
    citedPublished: [],
    citedVerifiedAt: [],
    ...overrides,
  };
}

/** Build a document index entry with sensible defaults. */
function doc(overrides: Partial<DocIndex> = {}): DocIndex {
  return {
    path: "Projects/note.md",
    title: "Note",
    body: "Body without citations.",
    tags: [],
    author: "",
    editor: "",
    created: null,
    modified: null,
    file_mtime: null,
    source_url: null,
    ...overrides,
  };
}

describe("resolveWindowDays", () => {
  it("prefers a positive review interval over tag and default windows", () => {
    expect(resolveWindowDays(["quick"], 100, CONFIG)).toBe(100);
  });

  it("uses the smallest numeric matching tag window", () => {
    expect(resolveWindowDays(["slower", "quick", "unknown"], null, CONFIG)).toBe(10);
  });

  it("returns null when every matching tag window is null", () => {
    expect(resolveWindowDays(["rust"], null, CONFIG)).toBeNull();
    expect(resolveWindowDays(["rust", "quick"], 0, CONFIG)).toBe(10);
  });

  it("falls back to the default window when no tag matches", () => {
    expect(resolveWindowDays(["misc"], null, CONFIG)).toBe(365);
  });
});

describe("computeFreshness", () => {
  it("labels a note stale when its age exceeds the window", () => {
    const result = computeFreshness(input({ reviewed: "2024-12-01" }), CONFIG, NOW);
    expect(result.ageDays).toBe(396);
    expect(result.windowDays).toBe(365);
    expect(result.status).toBe("stale");
  });

  it("labels a note aging above 75 percent of the window", () => {
    const result = computeFreshness(input({ reviewed: "2025-03-01" }), CONFIG, NOW);
    expect(result.ageDays).toBe(306);
    expect(result.status).toBe("aging");
  });

  it("labels a note fresh at or below 75 percent of the window", () => {
    const result = computeFreshness(input({ reviewed: "2025-04-15" }), CONFIG, NOW);
    expect(result.ageDays).toBe(261);
    expect(result.status).toBe("fresh");
  });

  it("labels a note fresh when the window is null", () => {
    const result = computeFreshness(input({ tags: ["rust"], reviewed: "2000" }), CONFIG, NOW);
    expect(result.windowDays).toBeNull();
    expect(result.status).toBe("fresh");
  });

  it("returns unknown when no basis date exists", () => {
    const result = computeFreshness(input({ tags: ["quick"] }), CONFIG, NOW);
    expect(result.status).toBe("unknown");
    expect(result.basis).toBeNull();
    expect(result.ageDays).toBeNull();
    expect(result.windowDays).toBe(10);
  });

  it("prefers reviewed over every other date source", () => {
    const result = computeFreshness(
      input({
        reviewed: "2025-12-01",
        citedPublished: ["2020", "2021-06"],
        citedVerifiedAt: ["2024-01-01"],
        noteModified: "2022-01-01",
      }),
      CONFIG,
      NOW,
    );
    expect(result.basis).toBe("reviewed");
    expect(result.ageDays).toBe(31);
  });

  it("falls back to the newest cited publication", () => {
    const result = computeFreshness(
      input({
        citedPublished: ["2020", "2021-06-15", null, "not-a-date"],
        citedVerifiedAt: ["2024-01-01"],
        noteModified: "2022-01-01",
      }),
      CONFIG,
      NOW,
    );
    expect(result.basis).toBe("source");
    expect(result.newestSourcePublished).toBe("2021-06-15");
    expect(result.ageDays).toBe(1661);
  });

  it("falls back to the latest verification when no publication exists", () => {
    const result = computeFreshness(
      input({
        citedVerifiedAt: ["2023-01-01", "2025-01-01", "2024"],
        noteModified: "2022-01-01",
      }),
      CONFIG,
      NOW,
    );
    expect(result.basis).toBe("verified");
    expect(result.lastVerified).toBe("2025-01-01");
    expect(result.ageDays).toBe(365);
  });

  it("falls back to the note modification date last", () => {
    const result = computeFreshness(input({ noteModified: "2025-01-01" }), CONFIG, NOW);
    expect(result.basis).toBe("modified");
    expect(result.noteModified).toBe("2025-01-01");
    expect(result.status).toBe("aging");
  });

  it("pads partial dates to the first day of the period", () => {
    const yearOnly = computeFreshness(input({ reviewed: "2025" }), CONFIG, NOW);
    const monthOnly = computeFreshness(input({ reviewed: "2025-12" }), CONFIG, NOW);
    const fullDate = computeFreshness(input({ reviewed: "2025-12-01" }), CONFIG, NOW);

    expect(yearOnly.ageDays).toBe(365);
    expect(monthOnly.ageDays).toBe(31);
    expect(fullDate.ageDays).toBe(31);
  });

  it("uses the review interval as the window and tag defaults otherwise", () => {
    const explicit = computeFreshness(
      input({ tags: ["quick"], reviewed: "2025-12-01", reviewInterval: 90 }),
      CONFIG,
      NOW,
    );
    expect(explicit.windowDays).toBe(90);
    expect(explicit.status).toBe("fresh");
  });
});

describe("loadFreshness", () => {
  it("reads the files row, tags and joined citation dates", () => {
    const db: SqliteDb = createDb(":memory:");
    initDb(db);
    try {
      indexFile(
        db,
        doc({
          path: "Projects/sourced.md",
          tags: ["legacy"],
          modified: "2024-01-01T00:00:00.000Z",
          citekeys: ["alpha", "beta"],
        }),
      );
      db.prepare(
        "INSERT INTO citations (citekey, bibtex, published, verified_at) VALUES (?, ?, ?, ?)",
      ).run("alpha", "@misc{alpha}", "2025-11-01", "2024-01-01");
      db.prepare(
        "INSERT INTO citations (citekey, bibtex, published, verified_at) VALUES (?, ?, ?, ?)",
      ).run("beta", "@misc{beta}", "2025-08", "2025-12-01");

      const result = loadFreshness(db, "Projects/sourced.md", CONFIG, NOW);

      expect(result.windowDays).toBe(30);
      expect(result.basis).toBe("source");
      expect(result.newestSourcePublished).toBe("2025-11-01");
      expect(result.lastVerified).toBe("2025-12-01");
      expect(result.noteModified).toBe("2024-01-01T00:00:00.000Z");
      expect(result.ageDays).toBe(61);
      expect(result.status).toBe("stale");
    } finally {
      db.close();
    }
  });

  it("returns unknown for an unindexed path", () => {
    const db: SqliteDb = createDb(":memory:");
    initDb(db);
    try {
      const result = loadFreshness(db, "Projects/missing.md", CONFIG, NOW);
      expect(result.status).toBe("unknown");
      expect(result.reviewed).toBeNull();
      expect(result.windowDays).toBe(365);
    } finally {
      db.close();
    }
  });
});
