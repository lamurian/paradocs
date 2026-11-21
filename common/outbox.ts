/**
 * Staging outbox writer for PARA notes.
 *
 * A batch is written under `<cwd>/.pi/paradocs/outbox/<batchId>/` so the
 * read-only staging step never touches KNOWLEDGE_DIR. Ingest later consumes
 * the batch directory as its only input.
 *
 * @module common/outbox
 */

import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { slugify } from "./slug.ts";

import type { RenderedNote } from "./note-render.ts";
import type { StageNoteInput, StagedCitation } from "./stage-validate.ts";

/** One note ready to be written to the outbox. */
export interface OutboxNote {
  input: StageNoteInput;
  rendered: RenderedNote;
  baseHash: string | null;
}

/** A complete staging batch. */
export interface OutboxBatch {
  notes: OutboxNote[];
  citations: StagedCitation[];
}

/** Manifest entry describing one staged note. */
export interface OutboxManifestNote {
  file: string;
  mode: "create" | "update";
  targetPath: string;
  baseHash: string | null;
  title: string;
  tags: string[];
}

/** Manifest written alongside the batch. */
export interface OutboxManifest {
  batchId: string;
  createdAt: string;
  notes: OutboxManifestNote[];
}

/** Location of a written batch. */
export interface WrittenBatch {
  batchId: string;
  dir: string;
}

/**
 * Compute the SHA-256 hex digest of a file's contents.
 *
 * @param path - Absolute path to the file.
 * @returns Lowercase hex digest of the file bytes.
 */
export function sha256File(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

/** Generate a batch id of the form `b-<time base36>-<6 random chars>`. */
function createBatchId(): string {
  const time = Date.now().toString(36);
  const rand = randomBytes(3).toString("hex");
  return `b-${time}-${rand}`;
}

/** Build the manifest note entry for one staged note. */
function manifestEntry(note: OutboxNote, file: string): OutboxManifestNote {
  const { input } = note;
  const targetPath =
    input.mode === "create" ? `${input.area}/${slugify(input.title)}.md` : (input.targetPath ?? "");

  return {
    file,
    mode: input.mode,
    targetPath,
    baseHash: note.baseHash,
    title: input.title,
    tags: [...input.tags],
  };
}

/**
 * Write a staging batch to the cwd outbox.
 *
 * Creates `notes/<slug>.md` per note, plus `citations.json` and
 * `manifest.json` describing the batch.
 *
 * @param cwd - Project working directory that owns the outbox.
 * @param batch - Notes and citations to stage.
 * @returns The generated batch id and its absolute directory.
 */
export function writeOutboxBatch(cwd: string, batch: OutboxBatch): WrittenBatch {
  const batchId = createBatchId();
  const dir = join(cwd, ".pi", "paradocs", "outbox", batchId);
  const notesDir = join(dir, "notes");
  mkdirSync(notesDir, { recursive: true });

  const manifestNotes: OutboxManifestNote[] = [];

  for (const note of batch.notes) {
    const file = `notes/${slugify(note.input.title)}.md`;
    writeFileSync(join(dir, file), note.rendered.markdown, "utf8");
    manifestNotes.push(manifestEntry(note, file));
  }

  writeFileSync(
    join(dir, "citations.json"),
    `${JSON.stringify(batch.citations, null, 2)}\n`,
    "utf8",
  );

  const manifest: OutboxManifest = {
    batchId,
    createdAt: new Date().toISOString(),
    notes: manifestNotes,
  };
  writeFileSync(join(dir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  return { batchId, dir };
}
