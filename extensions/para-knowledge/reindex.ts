/**
 * Incremental reindex of the SQLite knowledge base.
 *
 * Compares the real file mtime of every PARA markdown file against the
 * `files.file_mtime` value stored in `notes.db`. New and modified files are
 * re-parsed and indexed, entries for deleted files are removed, and unchanged
 * files are left untouched.
 */

import { indexFile, removeFile } from "./db-sqlite.ts";
import { parseFile, scanAllParaDirs } from "./files.ts";

import type { DocIndex, SqliteDb } from "./db-sqlite.ts";

/** Counts returned by {@link reindexChanged}. */
export interface ReindexResult {
  /** Number of new or modified files indexed. */
  indexed: number;
  /** Number of indexed paths removed because the file is gone. */
  removed: number;
  /** Number of files whose mtime matched the index. */
  unchanged: number;
}

/** A single row from the `files` table used for change detection. */
interface IndexedFileRow {
  path: string;
  file_mtime: string | null;
}

/**
 * Bring `notes.db` in sync with the markdown files on disk.
 *
 * @param db - Open SQLite handle for the knowledge base.
 * @param knowledgeDir - Root directory containing Areas/, Projects/, Resources/.
 * @returns Counts of indexed, removed and unchanged documents.
 */
export async function reindexChanged(db: SqliteDb, knowledgeDir: string): Promise<ReindexResult> {
  const entries = await scanAllParaDirs(knowledgeDir);
  const rows = db.prepare("SELECT path, file_mtime FROM files").all<IndexedFileRow>();
  const known = new Map(rows.map((row) => [row.path, row.file_mtime]));

  let indexed = 0;
  let removed = 0;
  let unchanged = 0;
  const seen = new Set<string>();

  for (const entry of entries) {
    seen.add(entry.path);
    const mtime = new Date(entry.mtimeMs).toISOString();

    if (known.get(entry.path) === mtime) {
      unchanged++;
      continue;
    }

    const parsed = await parseFile(entry);
    const doc: DocIndex = {
      path: entry.path,
      title: parsed.title,
      body: (parsed.description ?? "") + "\n" + parsed.body,
      tags: parsed.tags,
      author: parsed.author || "pi",
      editor: parsed.editor || "",
      created: parsed.created ?? mtime,
      modified: mtime,
      file_mtime: mtime,
      source_url: parsed.source_url,
      description: parsed.description,
      reviewed: parsed.reviewed,
      reviewInterval: parsed.review_interval,
    };
    indexFile(db, doc);
    indexed++;
  }

  for (const path of known.keys()) {
    if (seen.has(path)) continue;
    removeFile(db, path);
    removed++;
  }

  return { indexed, removed, unchanged };
}
