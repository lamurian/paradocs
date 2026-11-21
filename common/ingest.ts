/**
 * Ingest the cwd outbox into the PARA knowledge base.
 *
 * Ingest is the only writer of KNOWLEDGE_DIR files, notes.db and ref.bib. It
 * processes staged batch directories in name order, respects staged base
 * hashes by parking conflicts, indexes every written note and moves processed
 * batches under `outbox/.ingested/`.
 *
 * @module common/ingest
 */

import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";

import { commitCitations } from "./citation-commit.ts";
import { commitKnowledgeBase } from "./gitCommit.ts";
import { indexNoteFile } from "./ingest-notes.ts";
import { sha256File } from "./outbox.ts";

import type { OutboxManifest, OutboxManifestNote } from "./outbox.ts";
import type { StagedCitation } from "./stage-validate.ts";
import type { SqliteDb } from "../extensions/para-knowledge/sqlite-types.ts";

/** A batch or note that could not be ingested. */
export interface IngestSkip {
  path: string;
  reason: string;
}

/** Summary of one ingest run. */
export interface IngestReport {
  batches: string[];
  created: string[];
  updated: string[];
  skipped: IngestSkip[];
  conflicts: string[];
  citationsAdded: string[];
  commit: string | null;
}

/** Inputs shared by the per-batch helpers. */
interface IngestContext {
  knowledgeDir: string;
  db: SqliteDb;
  now: Date;
  report: IngestReport;
}

/** Locations used during one ingest run. */
interface OutboxPaths {
  root: string;
  ingested: string;
  conflicts: string;
}

/** Return true when a directory name is a batch id rather than a hidden marker. */
function isBatchDir(name: string): boolean {
  return !name.startsWith(".");
}

/** Read and validate a batch manifest. */
async function readManifest(batchDir: string): Promise<OutboxManifest> {
  const raw = await readFile(join(batchDir, "manifest.json"), "utf8");
  const parsed = JSON.parse(raw) as Partial<OutboxManifest>;
  if (!parsed || !Array.isArray(parsed.notes)) {
    throw new Error("manifest is missing a notes array");
  }
  return parsed as OutboxManifest;
}

/** Read staged citations, treating a missing or malformed file as empty. */
async function readCitations(batchDir: string): Promise<StagedCitation[]> {
  try {
    const raw = await readFile(join(batchDir, "citations.json"), "utf8");
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as StagedCitation[]) : [];
  } catch {
    return [];
  }
}

/** Describe an unknown thrown value for a skip reason. */
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Record a skip against the manifest note path. */
function skip(ctx: IngestContext, note: OutboxManifestNote, reason: string): void {
  ctx.report.skipped.push({ path: note.targetPath || note.file, reason });
}

/** Move a draft into the conflict parking area for this batch. */
async function parkConflict(
  paths: OutboxPaths,
  batchId: string,
  draftPath: string,
): Promise<string> {
  const parked = join(paths.conflicts, batchId, basename(draftPath));
  await mkdir(dirname(parked), { recursive: true });
  await rename(draftPath, parked);
  return parked;
}

/** Copy a draft's contents over the target and index the result. */
async function writeAndIndex(
  ctx: IngestContext,
  draftPath: string,
  targetPath: string,
): Promise<void> {
  const content = await readFile(draftPath, "utf8");
  const targetAbs = resolve(ctx.knowledgeDir, targetPath);
  await mkdir(dirname(targetAbs), { recursive: true });
  await writeFile(targetAbs, content, "utf8");
  await indexNoteFile(ctx.db, ctx.knowledgeDir, targetPath, ctx.now);
}

/** Apply one manifest note, recording created, updated, skipped or conflict. */
async function applyNote(
  ctx: IngestContext,
  paths: OutboxPaths,
  batchId: string,
  batchDir: string,
  note: OutboxManifestNote,
): Promise<void> {
  const targetPath = note.targetPath?.trim() ?? "";
  if (targetPath.length === 0) {
    skip(ctx, note, "missing targetPath");
    return;
  }

  const draftPath = resolve(batchDir, note.file);
  if (!existsSync(draftPath)) {
    skip(ctx, note, "draft file missing");
    return;
  }

  const targetAbs = resolve(ctx.knowledgeDir, targetPath);

  if (note.mode === "create") {
    if (existsSync(targetAbs)) {
      skip(ctx, note, "target exists");
      return;
    }
    await writeAndIndex(ctx, draftPath, targetPath);
    ctx.report.created.push(targetPath);
    return;
  }

  if (note.mode === "update") {
    if (!existsSync(targetAbs)) {
      skip(ctx, note, "target missing");
      return;
    }
    if (note.baseHash === null || sha256File(targetAbs) !== note.baseHash) {
      await parkConflict(paths, batchId, draftPath);
      ctx.report.conflicts.push(targetPath);
      return;
    }
    await writeAndIndex(ctx, draftPath, targetPath);
    ctx.report.updated.push(targetPath);
    return;
  }

  skip(ctx, note, `unknown mode: ${String(note.mode)}`);
}

/** Process one batch directory, moving it to `.ingested` when done. */
async function processBatch(
  ctx: IngestContext,
  paths: OutboxPaths,
  batchName: string,
): Promise<void> {
  const batchDir = join(paths.root, batchName);

  let manifest: OutboxManifest;
  try {
    manifest = await readManifest(batchDir);
  } catch (error) {
    ctx.report.skipped.push({
      path: batchName,
      reason: `malformed manifest: ${errorMessage(error)}`,
    });
    return;
  }

  const batchId = manifest.batchId || batchName;
  for (const note of manifest.notes) {
    await applyNote(ctx, paths, batchId, batchDir, note);
  }

  const citations = await readCitations(batchDir);
  if (citations.length > 0) {
    const result = await commitCitations(ctx.db, ctx.knowledgeDir, citations);
    ctx.report.citationsAdded.push(...result.added);
  }

  await mkdir(paths.ingested, { recursive: true });
  await rename(batchDir, join(paths.ingested, batchName));
  ctx.report.batches.push(batchId);
}

/** Commit the knowledge base once per run when it changed. */
async function commitRun(cwd: string, ctx: IngestContext): Promise<string | null> {
  const { report } = ctx;
  const changed =
    report.created.length > 0 || report.updated.length > 0 || report.citationsAdded.length > 0;
  if (!changed) return null;

  const message = `ingest: ${report.batches.length} batch(es), ${report.created.length} created, ${report.updated.length} updated`;
  const result = await commitKnowledgeBase(message, cwd);
  return result.hash ?? null;
}

/**
 * Ingest every staged batch under `<cwd>/.pi/paradocs/outbox/`.
 *
 * Batch directories are processed in name order; `.ingested` and `.conflicts`
 * are excluded. Creates never overwrite an existing target, updates whose base
 * hash no longer matches are parked as conflicts, and every written note is
 * re-parsed and indexed so note_citations stay in sync.
 *
 * @param cwd - Project working directory that owns the outbox.
 * @param opts - Knowledge base root, writable notes.db handle and ingest clock.
 * @returns A report of batches, writes, skips, conflicts, citations and commit.
 */
export async function ingestOutbox(
  cwd: string,
  opts: { knowledgeDir: string; db: SqliteDb; now: Date },
): Promise<IngestReport> {
  const paths: OutboxPaths = {
    root: join(cwd, ".pi", "paradocs", "outbox"),
    ingested: join(cwd, ".pi", "paradocs", "outbox", ".ingested"),
    conflicts: join(cwd, ".pi", "paradocs", "outbox", ".conflicts"),
  };

  const report: IngestReport = {
    batches: [],
    created: [],
    updated: [],
    skipped: [],
    conflicts: [],
    citationsAdded: [],
    commit: null,
  };

  if (!existsSync(paths.root)) return report;

  const ctx: IngestContext = {
    knowledgeDir: opts.knowledgeDir,
    db: opts.db,
    now: opts.now,
    report,
  };

  const entries = await readdir(paths.root, { withFileTypes: true });
  const batchNames = entries
    .filter((entry) => entry.isDirectory() && isBatchDir(entry.name))
    .map((entry) => entry.name)
    .sort();

  for (const batchName of batchNames) {
    await processBatch(ctx, paths, batchName);
  }

  report.commit = await commitRun(cwd, ctx);
  return report;
}
