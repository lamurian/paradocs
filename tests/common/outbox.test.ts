/**
 * Tests for common/outbox.ts — staging batch layout and manifest contents.
 */

import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { sha256File, writeOutboxBatch } from "../../common/outbox.ts";

import type { OutboxNote } from "../../common/outbox.ts";

/** Build a staged note with a rendered markdown body. */
function outboxNote(overrides: Partial<OutboxNote> = {}): OutboxNote {
  return {
    input: {
      mode: "create",
      title: "Outbox Test Note",
      description: "A note staged in the outbox",
      tags: ["testing"],
      area: "Resources",
      summary: ["A summary paragraph."],
      keyPoints: ["A key point."],
    },
    rendered: { markdown: "# rendered\n", contentLines: 2, citekeys: [] },
    baseHash: null,
    ...overrides,
  };
}

describe("writeOutboxBatch", () => {
  let tmpDir: string;
  let cwd: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "outbox-test-"));
    cwd = join(tmpDir, "project");
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("writes notes, citations and a manifest under the batch directory", () => {
    const existing = join(tmpDir, "existing.md");
    writeFileSync(existing, "old body\n");

    const result = writeOutboxBatch(cwd, {
      notes: [
        outboxNote(),
        outboxNote({
          input: {
            mode: "update",
            targetPath: "Resources/existing.md",
            title: "Existing Note",
            description: "An update",
            tags: ["testing"],
            area: "Resources",
            summary: ["Updated summary."],
            keyPoints: ["Updated point."],
          },
          rendered: { markdown: "updated\n", contentLines: 1, citekeys: [] },
          baseHash: sha256File(existing),
        }),
      ],
      citations: [{ citekey: "smith2024", bibtex: "@misc{smith2024, title={Test}}" }],
    });

    expect(result.batchId).toMatch(/^b-[a-z0-9]+-[a-z0-9]{6}$/);
    expect(result.dir).toBe(join(cwd, ".pi", "paradocs", "outbox", result.batchId));

    const noteFile = join(result.dir, "notes", "outbox-test-note.md");
    expect(existsSync(noteFile)).toBe(true);
    expect(readFileSync(noteFile, "utf8")).toBe("# rendered\n");
    expect(existsSync(join(result.dir, "notes", "existing-note.md"))).toBe(true);

    const citations = JSON.parse(readFileSync(join(result.dir, "citations.json"), "utf8")) as {
      citekey: string;
    }[];
    expect(citations).toEqual([{ citekey: "smith2024", bibtex: "@misc{smith2024, title={Test}}" }]);

    const manifest = JSON.parse(readFileSync(join(result.dir, "manifest.json"), "utf8")) as {
      batchId: string;
      createdAt: string;
      notes: {
        file: string;
        mode: string;
        targetPath: string;
        baseHash: string | null;
        title: string;
        tags: string[];
      }[];
    };

    expect(manifest.batchId).toBe(result.batchId);
    expect(typeof manifest.createdAt).toBe("string");
    expect(manifest.notes[0]).toEqual({
      file: "notes/outbox-test-note.md",
      mode: "create",
      targetPath: "Resources/outbox-test-note.md",
      baseHash: null,
      title: "Outbox Test Note",
      tags: ["testing"],
    });
    expect(manifest.notes[1]).toEqual({
      file: "notes/existing-note.md",
      mode: "update",
      targetPath: "Resources/existing.md",
      baseHash: sha256File(existing),
      title: "Existing Note",
      tags: ["testing"],
    });
  });
});

describe("sha256File", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "sha256-test-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns the sha256 hex digest of the file contents", () => {
    const file = join(tmpDir, "file.txt");
    writeFileSync(file, "hello\n");

    expect(sha256File(file)).toBe(
      "5891b5b522d5df086d0ff0b110fbd9d21bb4fc7163af34d08286a2e846f6be03",
    );
  });
});
