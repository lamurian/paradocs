/**
 * Document indexing (insert, update, delete) for the SQLite knowledge base.
 *
 * Each function operates on three storage backends:
 * - `files` table — document metadata
 * - `tags` table — tag index
 * - `docs_fts` — FTS5 full-text search index
 */

import type { SqliteDb, DocIndex } from "./sqlite-types.js";

// ── Insert or update a document ──

/**
 * Insert or update a document in all index tables (files, tags, docs_fts).
 *
 * For FTS5, the old entry (if any) is deleted before inserting, using the
 * content shadow table to find the FTS5 rowid by document path.
 */
export function indexFile(db: SqliteDb, doc: DocIndex): void {
  const now = new Date().toISOString();
  const created = doc.created ?? now;
  const modified = doc.modified ?? now;
  const fileMtime = doc.file_mtime ?? now;

  // Files table (upsert)
  db.prepare(
    `INSERT OR REPLACE INTO files (path, title, author, editor, created, modified, file_mtime, source_url)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(doc.path, doc.title, doc.author, doc.editor, created, modified, fileMtime, doc.source_url);

  // Tags (delete all, insert fresh)
  db.prepare("DELETE FROM tags WHERE file_path = ?").run(doc.path);
  for (const tag of doc.tags) {
    db.prepare("INSERT OR IGNORE INTO tags (file_path, tag) VALUES (?, ?)").run(doc.path, tag);
  }

  // FTS5 (delete old entry, insert new)
  deleteFtsEntry(db, doc.path);
  const tagsCsv = doc.tags.join(", ");
  db.prepare(
    "INSERT INTO docs_fts (path, title, body, tags_csv) VALUES (?, ?, ?, ?)",
  ).run(doc.path, doc.title, doc.body, tagsCsv);
}

// ── Remove a document ──

/**
 * Remove a document from all index tables (files, tags, docs_fts).
 */
export function removeFile(db: SqliteDb, path: string): void {
  db.prepare("DELETE FROM files WHERE path = ?").run(path);
  db.prepare("DELETE FROM tags WHERE file_path = ?").run(path);
  deleteFtsEntry(db, path);
}

// ── Recompute corpus stats ──

/**
 * Recompute corpus-level statistics. With FTS5, BM25 statistics are managed
 * internally. Kept for API compatibility — currently a no-op.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function recomputeStats(_db: SqliteDb): void {
  // FTS5 manages BM25 statistics internally.
}

// ── Internal helpers ──

/** Delete a document from the FTS5 index by finding its rowid via the content shadow table. */
function deleteFtsEntry(db: SqliteDb, path: string): void {
  const existing = db.prepare(
    "SELECT id FROM docs_fts_content WHERE c0 = ?",
  ).get<{ id: number }>(path);
  if (existing) {
    db.prepare("DELETE FROM docs_fts WHERE rowid = ?").run(existing.id);
  }
}

/** Get all tags for a given file path. */
export function getFileTags(db: SqliteDb, filePath: string): string[] {
  const rows = db.prepare(
    "SELECT tag FROM tags WHERE file_path = ? ORDER BY tag",
  ).all<{ tag: string }>(filePath);
  return rows.map((r) => r.tag);
}
