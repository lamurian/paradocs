/**
 * Note indexing helpers for the ingest path.
 *
 * Ingest is the only writer of KNOWLEDGE_DIR files and notes.db. These
 * helpers re-read a written note from disk and index it exactly like a full
 * rebuild would, so search results and note_citations match the file.
 *
 * @module common/ingest-notes
 */

import { resolve } from "node:path";

import { parseFile } from "../extensions/para-knowledge/files.ts";
import { indexFile } from "../extensions/para-knowledge/sqlite-indexing.ts";

import type { DocIndex, SqliteDb  } from "../extensions/para-knowledge/sqlite-types.ts";
import type { FileEntry, ParsedFile } from "../extensions/para-knowledge/types.ts";

/**
 * Build the DocIndex row for a parsed note file.
 *
 * Mirrors the full-rebuild shape: the description is prepended to the body so
 * BM25 sees it, and the caller supplies the modification timestamp.
 *
 * @param entry - File entry with relative and absolute paths.
 * @param parsed - Parsed frontmatter and body.
 * @param modified - ISO timestamp used for modified and file_mtime.
 * @returns A document row ready for indexFile.
 */
export function buildDocIndex(entry: FileEntry, parsed: ParsedFile, modified: string): DocIndex {
  return {
    path: entry.path,
    title: parsed.title,
    body: (parsed.description ?? "") + "\n" + parsed.body,
    tags: parsed.tags,
    author: parsed.author || "pi",
    editor: parsed.editor || "",
    created: parsed.created ?? modified,
    modified,
    file_mtime: modified,
    source_url: parsed.source_url,
    description: parsed.description,
    reviewed: parsed.reviewed,
    reviewInterval: parsed.review_interval,
  };
}

/**
 * Parse a written note from KNOWLEDGE_DIR and index it into notes.db.
 *
 * The note must already exist on disk; this function only reads it. Indexing
 * fills files, tags, docs_fts and note_citations in one call.
 *
 * @param db - Open writable notes.db handle.
 * @param knowledgeDir - KNOWLEDGE_DIR root that owns the note.
 * @param targetPath - Relative note path such as `Resources/alpha.md`.
 * @param now - Ingest clock used for the file modification timestamp.
 * @returns The document row that was indexed.
 */
export async function indexNoteFile(
  db: SqliteDb,
  knowledgeDir: string,
  targetPath: string,
  now: Date,
): Promise<DocIndex> {
  const absPath = resolve(knowledgeDir, targetPath);
  const modified = now.toISOString();
  const entry: FileEntry = { path: targetPath, absPath, mtimeMs: now.getTime() };
  const parsed = await parseFile(entry);
  const doc = buildDocIndex(entry, parsed, modified);
  indexFile(db, doc);
  return doc;
}
