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
import { validateDocumentsAtomicity } from "../../common/atomicity.js";
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
  message: string;
}

export interface CitationViolation {
  title: string;
  missing: string[];
}

// ── Atomicity validation ────────────────────────────────────────────

/**
 * Validate all documents for atomicity and separate valid from invalid.
 *
 * Documents that fail atomicity with suggested splits are automatically
 * expanded: the failed doc is replaced by its suggested splits in the
 * valid docs array. Documents that fail without splits are moved to
 * validationErrors.
 *
 * @param docs - Array of documents to validate.
 * @returns Valid docs (possibly expanded), errors, and expansion stats.
 */
export async function validateDocuments(docs: BatchDoc[]): Promise<{
  validDocs: BatchDoc[];
  validationErrors: ValidationError[];
  expandedCount: number;
}> {
  const results = await validateDocumentsAtomicity(docs);

  const validDocs: BatchDoc[] = [];
  const validationErrors: ValidationError[] = [];
  let expandedCount = 0;

  for (let i = 0; i < docs.length; i++) {
    const result = results[i];

    if (result.valid) {
      validDocs.push(docs[i]);
    } else if (result.suggestedSplits && result.suggestedSplits.length > 0) {
      // Expand: replace the failed doc with its suggested splits
      for (const split of result.suggestedSplits) {
        if (split.content.trim()) {
          validDocs.push({
            title: split.title,
            content: split.content,
            tags: split.tags,
            area: split.area,
          });
        }
      }
      expandedCount += result.suggestedSplits.length;
    } else {
      // Failed without splits — move to errors
      validationErrors.push({
        title: docs[i].title,
        message: result.message,
      });
    }
  }

  return { validDocs, validationErrors, expandedCount };
}

/**
 * Build a human-readable note about skipped documents.
 *
 * @param errors - Validation errors from documents that couldn't be expanded.
 * @returns Formatted string, empty if no errors.
 */
export function buildSkippedNote(errors: ValidationError[]): string {
  if (errors.length === 0) return "";
  return (
    `\n⚠️  ${errors.length} document(s) skipped — could not be expanded:\n` +
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
