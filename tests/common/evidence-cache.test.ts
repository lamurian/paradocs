/**
 * Tests for common/evidence-cache.ts — pack persistence and content caps.
 */

import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  MAX_SOURCE_CONTENT_CHARS,
  loadEvidencePack,
  saveEvidencePack,
} from "../../common/evidence-cache.ts";

import type { EvidencePack, EvidenceSource } from "../../common/evidence-cache.ts";

/** Build a source with optional overrides. */
function makeSource(overrides: Partial<EvidenceSource> = {}): EvidenceSource {
  return {
    url: "https://example.com/article",
    canonicalUrl: "https://example.com/article",
    title: "Example article",
    trust: "unknown",
    tier: 3,
    query: "example query",
    excerpt: "An excerpt.",
    ...overrides,
  };
}

/** Build a pack without an id. */
function makePack(overrides: Partial<Omit<EvidencePack, "id">> = {}): Omit<EvidencePack, "id"> {
  return {
    question: "What is evidence caching?",
    createdAt: "2025-01-02T03:04:05.000Z",
    queries: [
      {
        query: "evidence cache",
        kbCovered: false,
        since: null,
        kbHits: [{ path: "Resources/cache.md", title: "Cache", freshness: "fresh" }],
      },
    ],
    sources: [makeSource()],
    ...overrides,
  };
}

describe("saveEvidencePack", () => {
  let tmpDir: string;
  let cwd: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "evidence-cache-test-"));
    cwd = join(tmpDir, "project");
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("writes the pack under .pi/paradocs/evidence and returns the generated id", () => {
    const saved = saveEvidencePack(cwd, makePack());

    expect(saved.id).toMatch(/^ev-[a-z0-9]+-[a-f0-9]{4}$/);

    const file = join(cwd, ".pi", "paradocs", "evidence", `${saved.id}.json`);
    expect(existsSync(file)).toBe(true);

    const onDisk = JSON.parse(readFileSync(file, "utf8")) as EvidencePack;
    expect(onDisk).toEqual(saved);
    expect(onDisk.question).toBe("What is evidence caching?");
    expect(onDisk.createdAt).toBe("2025-01-02T03:04:05.000Z");
    expect(onDisk.queries).toEqual(makePack().queries);
    expect(onDisk.sources).toEqual(makePack().sources);
  });

  it("generates a distinct id per save", () => {
    const first = saveEvidencePack(cwd, makePack());
    const second = saveEvidencePack(cwd, makePack());

    expect(first.id).not.toBe(second.id);
  });

  it("caps each source content at 50000 characters", () => {
    const longContent = "x".repeat(MAX_SOURCE_CONTENT_CHARS + 250);
    const saved = saveEvidencePack(
      cwd,
      makePack({ sources: [makeSource({ content: longContent })] }),
    );

    expect(saved.sources[0].content).toHaveLength(MAX_SOURCE_CONTENT_CHARS);

    const reloaded = loadEvidencePack(cwd, saved.id);
    expect(reloaded?.sources[0].content).toHaveLength(MAX_SOURCE_CONTENT_CHARS);
  });

  it("keeps source content at or below the cap unchanged", () => {
    const saved = saveEvidencePack(cwd, makePack({ sources: [makeSource({ content: "short" })] }));
    expect(saved.sources[0].content).toBe("short");
  });
});

describe("loadEvidencePack", () => {
  let tmpDir: string;
  let cwd: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "evidence-cache-load-"));
    cwd = join(tmpDir, "project");
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns the stored pack by id", () => {
    const saved = saveEvidencePack(cwd, makePack());
    expect(loadEvidencePack(cwd, saved.id)).toEqual(saved);
  });

  it("returns null for a missing pack", () => {
    expect(loadEvidencePack(cwd, "ev-missing-0000")).toBeNull();
  });

  it("returns null for unreadable JSON", () => {
    const dir = join(cwd, ".pi", "paradocs", "evidence");
    const saved = saveEvidencePack(cwd, makePack());
    const file = join(dir, `${saved.id}.json`);
    writeFileSync(file, "not json", "utf8");

    expect(loadEvidencePack(cwd, saved.id)).toBeNull();
  });
});
