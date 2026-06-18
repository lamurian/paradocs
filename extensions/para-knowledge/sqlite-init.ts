/**
 * SQLite database initialization — runtime detection, factory, schema.
 *
 * Supports both Bun (`bun:sqlite`) and Node.js (`node:sqlite`) runtimes
 * using a synchronous require-based fallback detection.
 */

import type { SqliteDb } from "./sqlite-types.js";

type DbConstructor = new (path: string, options?: Record<string, unknown>) => SqliteDb;

// ── Runtime detection — try bun:sqlite first, fall back to node:sqlite ──

let Database: DbConstructor;

try {
  // @ts-ignore - bun:sqlite is a Bun built-in, not in TS types
  Database = require("bun:sqlite").Database;
} catch {
  // @ts-ignore - node:sqlite is experimental in Node 22+
  Database = require("node:sqlite").DatabaseSync;
}

// ── Factory ──

/**
 * Open a SQLite database.
 * @param path  File path or `:memory:` for in-memory database.
 */
export function createDb(path: string): SqliteDb {
  const db = new Database(path);

  const rawDb = db as SqliteDb;
  rawDb.run = function run(sql: string, ...params: unknown[]): void {
    this.prepare(sql).run(...params);
  };
  rawDb.all = function all<T>(sql: string, ...params: unknown[]): T[] {
    return this.prepare(sql).all(...params) as T[];
  };
  rawDb.get = function get<T>(sql: string, ...params: unknown[]): T | undefined {
    return this.prepare(sql).get(...params) as T | undefined;
  };

  return rawDb;
}

// ── Schema ──

/**
 * Initialize the database schema:
 * - `files` — document metadata
 * - `tags` — tag index (composite PK)
 * - `docs_fts` — FTS5 full-text search index
 * - `citations` — BibTeX citation cache
 *
 * Sets WAL mode, synchronous NORMAL, and small cache size for <10 MB memory.
 */
export function initDb(db: SqliteDb): void {
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA synchronous = NORMAL");
  db.exec("PRAGMA cache_size = -2000"); // ~8 MB cache (2000 pages × 4 KB)

  db.exec(`CREATE TABLE IF NOT EXISTS files (
    path TEXT PRIMARY KEY,
    title TEXT NOT NULL DEFAULT '',
    author TEXT NOT NULL DEFAULT '',
    editor TEXT NOT NULL DEFAULT '',
    created TEXT,
    modified TEXT,
    file_mtime TEXT,
    source_url TEXT
  )`);

  db.exec(`CREATE TABLE IF NOT EXISTS tags (
    file_path TEXT NOT NULL,
    tag TEXT NOT NULL,
    PRIMARY KEY (file_path, tag)
  )`);
  db.exec("CREATE INDEX IF NOT EXISTS idx_tags_tag ON tags(tag)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_tags_path ON tags(file_path)");

  db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS docs_fts USING fts5(
    path, title, body, tags_csv,
    tokenize='porter unicode61'
  )`);

  db.exec(`CREATE TABLE IF NOT EXISTS citations (
    citekey TEXT PRIMARY KEY,
    bibtex TEXT NOT NULL,
    doi TEXT,
    source_url TEXT,
    created TEXT,
    updated TEXT
  )`);
  db.exec("CREATE INDEX IF NOT EXISTS idx_citations_doi ON citations(doi)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_citations_url ON citations(source_url)");
}
