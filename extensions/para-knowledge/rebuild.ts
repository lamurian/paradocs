/**
 * Rebuild the SQLite index from PARA markdown files on disk.
 *
 * Scans all three PARA directories (Areas, Projects, Resources) under a
 * knowledge base root, parses each `.md` file's frontmatter and body, and
 * indexes every document into `notes.db` via `indexFile`.
 *
 * This is used when `notes.db` is missing (e.g. after deletion) to
 * reconstruct the search index from the canonical markdown files.
 */

import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

import { createDb, initDb, indexFile } from "./db-sqlite.js";
import { scanAllParaDirs, parseFile } from "./files.js";

import type { DocIndex } from "./db-sqlite.js";

/**
 * Scan all PARA directories under `knowledgeDir` and index every `.md`
 * file into a fresh or existing `notes.db`.
 *
 * Creates the database if it doesn't exist, overwrites existing entries.
 *
 * @param knowledgeDir - Root directory containing Areas/, Projects/, Resources/.
 * @returns Number of documents indexed.
 */
export async function rebuildDb(knowledgeDir: string): Promise<number> {
  const entries = await scanAllParaDirs(knowledgeDir);
  const dbPath = resolve(knowledgeDir, "notes.db");
  mkdirSync(knowledgeDir, { recursive: true });
  const db = createDb(dbPath);
  initDb(db);

  let count = 0;
  try {
    for (const entry of entries) {
      const parsed = await parseFile(entry);
      const now = new Date().toISOString();
      const doc: DocIndex = {
        path: entry.path,
        title: parsed.title,
        body: (parsed.description ?? "") + "\n" + parsed.body,
        tags: parsed.tags,
        author: parsed.author || "pi",
        editor: parsed.editor || "",
        created: parsed.created ?? now,
        modified: now,
        file_mtime: now,
        source_url: parsed.source_url,
      };
      indexFile(db, doc);
      count++;
    }
  } finally {
    db.close();
  }

  return count;
}
