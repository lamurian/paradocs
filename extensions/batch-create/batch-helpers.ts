/**
 * Shared helpers for batch_create_para_docs.
 *
 * Handles file creation, DB indexing, auto-linking, and validation
 * logic extracted from index.ts to stay within the 300-line limit.
 *
 * @module extensions/batch-create/batch-helpers
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { slugify, formatFrontmatter } from "./yaml.js";
import { validateAtomicity } from "../../common/atomicity.js";
import { autoLink } from "../../common/autoLink.js";
import { ensureNotesDb } from "../../common/notesDb.js";
import { indexFile } from "../para-knowledge/db-sqlite.js";

import type { DocIndex } from "../para-knowledge/db-sqlite.js";

// ── Exported Types ────────────────────────────────────────────────────

export interface BatchDoc {
  title: string;
  content: string;
  tags: string[];
  area?: string;
  description?: string;
  source?: string;
}

export interface CreatedFile {
  path: string;
  title: string;
  relPath: string;
}

export interface ValidationError {
  title: string;
  rule: string;
  count: number;
  limit: number;
  message: string;
}

export interface CitationViolation {
  title: string;
  missing: string[];
}

// ── Atomicity validation ────────────────────────────────────────────

/**
 * Validate all documents for atomicity and separate valid from invalid.
 */
export function validateDocuments(docs: BatchDoc[]): {
  validDocs: BatchDoc[];
  validationErrors: ValidationError[];
} {
  const validDocs: BatchDoc[] = [];
  const validationErrors: ValidationError[] = [];

  for (const doc of docs) {
    const vr = validateAtomicity(doc.content, doc.title);
    if (vr.valid) {
      validDocs.push(doc);
    } else {
      validationErrors.push({
        title: doc.title,
        rule: vr.rule,
        count: vr.count,
        limit: vr.limit,
        message: vr.message,
      });
    }
  }

  return { validDocs, validationErrors };
}

/**
 * Build a human-readable note about skipped documents.
 */
export function buildSkippedNote(errors: ValidationError[]): string {
  if (errors.length === 0) return "";
  return (
    `\n⚠️  ${errors.length} document(s) skipped due to atomicity violations:\n` +
    errors.map((e) => `  • "${e.title}": ${e.message}`).join("\n")
  );
}

// ── File creation ────────────────────────────────────────────────────

/**
 * Create all document files on disk.
 * Returns metadata for each created file.
 */
export async function createFilesOnDisk(docs: BatchDoc[], cwd: string): Promise<CreatedFile[]> {
  const created: CreatedFile[] = [];

  for (let i = 0; i < docs.length; i++) {
    const doc = docs[i];
    const area = doc.area ?? "Resources";
    const dirPath = resolve(cwd, area);
    const slug = slugify(doc.title);
    const filePath = join(dirPath, `${slug}.md`);
    const relPath = `${area}/${slug}.md`;
    const now = new Date().toISOString();

    const frontmatterFields: Record<string, unknown> = {
      title: doc.title,
      author: "pi",
      editor: "lam",
      date: now,
      tags: doc.tags,
    };
    if (doc.description?.trim()) frontmatterFields.description = doc.description.trim();
    if (doc.source?.trim()) frontmatterFields.source = doc.source.trim();

    const fm = formatFrontmatter(frontmatterFields);
    await mkdir(dirPath, { recursive: true });
    await writeFile(filePath, fm + "\n" + doc.content, "utf-8");

    created.push({ path: filePath, title: doc.title, relPath });
  }

  return created;
}

// ── DB indexing ───────────────────────────────────────────────────────

/**
 * Index all documents in the SQLite notes.db.
 */
export async function indexDocumentsInDb(
  docs: BatchDoc[],
  created: CreatedFile[],
  cwd: string,
): Promise<void> {
  const db = await ensureNotesDb(cwd);
  for (let i = 0; i < docs.length; i++) {
    const doc = docs[i];
    const relPath = created[i].relPath;
    const docIndex: DocIndex = {
      path: relPath,
      title: doc.title,
      body: (doc.description ?? "") + "\n" + doc.content,
      tags: doc.tags,
      author: "pi",
      editor: "lam",
      created: new Date().toISOString(),
      modified: new Date().toISOString(),
      file_mtime: new Date().toISOString(),
      source_url: doc.source ?? null,
    };
    indexFile(db, docIndex);
  }
}

// ── Auto-linking ──────────────────────────────────────────────────────

/**
 * Run auto-linking across all created documents.
 * Returns the count of documents that received links.
 */
export async function autoLinkBatch(
  docs: BatchDoc[],
  created: CreatedFile[],
  cwd: string,
): Promise<number> {
  const db = await ensureNotesDb(cwd);
  const knowledgeDir = resolve(cwd);
  let linkCount = 0;
  for (let i = 0; i < docs.length; i++) {
    const doc = docs[i];
    const relPath = created[i].relPath;
    const count = await autoLink(relPath, doc.title, doc.tags, knowledgeDir, db);
    if (count > 0) linkCount++;
  }
  return linkCount;
}
