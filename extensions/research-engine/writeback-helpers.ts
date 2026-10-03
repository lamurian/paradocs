/**
 * Write-back helpers: citation resolution with deterministic metadata,
 * outdated-note updates, and batch note creation.
 *
 * @module extensions/research-engine/writeback-helpers
 */

import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { validateCitations } from "../../common/citation-validation.js";
import { resolveCitation } from "../../common/citation.js";
import { ensureNotesDb } from "../../common/notesDb.js";
import {
  validateDocuments,
  createFilesOnDisk,
  indexDocumentsInDb,
  autoLinkBatch,
} from "../batch-create/batch-helpers.js";
import { indexFile } from "../para-knowledge/db-sqlite.js";
import { parseFrontmatter, formatFrontmatter } from "../para-knowledge/frontmatter.js";

import type { ResearchSource } from "./types.js";
import type { SqliteDb } from "../para-knowledge/sqlite-types.js";
import type { Api, Model } from "@earendil-works/pi-ai";

/** One grouped atomic note produced by the LLM. */
export interface GroupedNote {
  title: string;
  content: string;
  tags: string[];
  area?: string;
  source?: string;
}

/** One outdated existing note detected by the LLM. */
export interface GroupedOutdated {
  path: string;
  reason: string;
  content: string;
}

/**
 * Resolve citations once per unique source URL, passing deterministic
 * metadata (title/authors/year) as citation.js fallback.
 *
 * @param sources - Research sources from the engine.
 * @param cwd - Working directory for env config resolution.
 * @returns URL-to-citekey map and skipped-item notes.
 */
export async function resolveAllCitations(
  sources: ResearchSource[],
  cwd: string,
): Promise<{ citekeys: Map<string, string>; skipped: string[] }> {
  const citekeys = new Map<string, string>();
  const skipped: string[] = [];
  for (const src of sources) {
    if (citekeys.has(src.url)) continue;
    const res = await resolveCitation(
      { source: src.url, title: src.title, authors: src.authors, year: src.year },
      { cwd },
    );
    if (res.citekey) citekeys.set(src.url, res.citekey);
    else skipped.push(`citation unresolved: ${src.url}`);
  }
  return { citekeys, skipped };
}

/**
 * Update an outdated note: read, merge refreshed content, reindex.
 *
 * @param note - Outdated note entry from the grouping result.
 * @param knowledgeDir - KNOWLEDGE_DIR resolved from env config.
 * @param cwd - Working directory for env config resolution.
 */
export async function updateExistingNote(
  note: GroupedOutdated,
  knowledgeDir: string,
  cwd: string,
): Promise<void> {
  const filePath = resolve(knowledgeDir, note.path);
  const existing = await readFile(filePath, "utf-8");
  const fm = parseFrontmatter(existing);
  const now = new Date().toISOString();
  const title = typeof fm.title === "string" ? fm.title : note.path;
  const tags = Array.isArray(fm.tags) ? fm.tags : [];

  const newFm = formatFrontmatter({
    title,
    author: "pi",
    editor: "lam",
    date: now,
    tags,
  });
  await writeFile(filePath, newFm + "\n" + note.content, "utf-8");

  const db = await ensureNotesDb(cwd);
  indexFile(db, {
    path: note.path,
    title,
    body: note.content,
    tags,
    author: "pi",
    editor: "lam",
    created: typeof fm.date === "string" ? fm.date : now,
    modified: now,
    file_mtime: now,
    source_url: null,
  });
}

/**
 * Create new notes via the batch-create path with validation.
 *
 * @param notes - Grouped notes from the LLM.
 * @param model - Model for atomicity validation.
 * @param db - Open notes.db handle.
 * @param knowledgeDir - KNOWLEDGE_DIR resolved from env config.
 * @param cwd - Working directory for env config resolution.
 * @returns Created note paths and skipped-item notes.
 */
export async function createNewNotes(
  notes: GroupedNote[],
  model: Model<Api>,
  db: SqliteDb,
  knowledgeDir: string,
  cwd: string,
): Promise<{ created: string[]; skipped: string[] }> {
  const created: string[] = [];
  const skipped: string[] = [];
  if (notes.length === 0) return { created, skipped };

  const { validDocs, validationErrors, warnings } = await validateDocuments(notes, model);
  for (const ve of validationErrors) skipped.push(`atomicity: ${ve.title}`);

  const payable: typeof validDocs = [];
  for (const doc of validDocs) {
    const vr = validateCitations(doc.content, db);
    if (vr.valid) payable.push(doc);
    else skipped.push(`unresolved citations: ${doc.title} (${vr.missing.join(", ")})`);
  }

  for (const w of warnings ?? []) {
    skipped.push(`atomicity unverified: ${w.title}`);
  }

  if (payable.length > 0) {
    const createdFiles = await createFilesOnDisk(payable, knowledgeDir);
    await indexDocumentsInDb(payable, createdFiles, cwd);
    await autoLinkBatch(payable, createdFiles, knowledgeDir);
    for (const f of createdFiles) created.push(f.relPath);
  }
  return { created, skipped };
}
