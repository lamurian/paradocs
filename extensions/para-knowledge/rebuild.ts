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

import { createDb, initDb, indexFile } from "./db-sqlite.ts";
import { scanAllParaDirs, parseFile } from "./files.ts";
import { getKnowledgeConfig } from "../../common/env.ts";

import type { DocIndex } from "./db-sqlite.ts";

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
  const dbPath = resolve(knowledgeDir, getKnowledgeConfig().db);
  mkdirSync(knowledgeDir, { recursive: true });
  const db = createDb(dbPath);
  initDb(db);

  let count = 0;
  try {
    for (const entry of entries) {
      const parsed = await parseFile(entry);
      const fileMtime = new Date(entry.mtimeMs).toISOString();
      const doc: DocIndex = {
        path: entry.path,
        title: parsed.title,
        body: (parsed.description ?? "") + "\n" + parsed.body,
        tags: parsed.tags,
        author: parsed.author || "pi",
        editor: parsed.editor || "",
        created: parsed.created ?? fileMtime,
        modified: fileMtime,
        file_mtime: fileMtime,
        source_url: parsed.source_url,
        description: parsed.description,
        reviewed: parsed.reviewed,
        reviewInterval: parsed.review_interval,
      };
      indexFile(db, doc);
      count++;
    }
  } finally {
    db.close();
  }

  return count;
}
