/**
 * SQLite database initialization — runtime detection, factory, schema.
 *
 * Supports both Bun (`bun:sqlite`) and Node.js (`node:sqlite`) runtimes
 * using a synchronous require-based fallback detection.
 */

import type { SqliteDb } from "./sqlite-types.ts";

type DbConstructor = new (path: string, options?: Record<string, unknown>) => SqliteDb;

// ── Runtime detection — try bun:sqlite first, fall back to node:sqlite ──

let Database: DbConstructor;
let isBunRuntime = false;

try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment
  Database = require("bun:sqlite").Database;
  isBunRuntime = true;
} catch {
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment
  Database = require("node:sqlite").DatabaseSync;
}

/** Options accepted by {@link createDb}. */
export interface CreateDbOptions {
  /** Open the database in read-only mode; it will never be created. */
  readOnly?: boolean;
}

// ── Factory ──

/**
 * Open a SQLite database.
 * @param path  File path or `:memory:` for in-memory database.
 * @param options  Optional connection options (read-only mode).
 * @returns A wrapped synchronous SQLite handle.
 */
export function createDb(path: string, options?: CreateDbOptions): SqliteDb {
  const constructorOptions = options?.readOnly
    ? isBunRuntime
      ? { readonly: true }
      : { readOnly: true }
    : undefined;
  const db = constructorOptions ? new Database(path, constructorOptions) : new Database(path);

  const rawDb = db;
  rawDb.run = function run(sql: string, ...params: unknown[]): void {
    this.prepare(sql).run(...params);
  };
  rawDb.all = function all<T>(sql: string, ...params: unknown[]): T[] {
    return this.prepare(sql).all(...params);
  };
  rawDb.get = function get<T>(sql: string, ...params: unknown[]): T | undefined {
    return this.prepare(sql).get(...params);
  };

  return rawDb;
}

// ── Schema ──

/**
 * Add a column to an existing table only if it is missing.
 * @param db      Database instance.
 * @param table   Table name to inspect and alter.
 * @param column  Column name to add.
 * @param type    SQLite column type/declaration for the new column.
 */
function addColumnIfMissing(db: SqliteDb, table: string, column: string, type: string): void {
  const rows = db.all<{ name: string }>(`PRAGMA table_info(${table})`);
  if (rows.some((row) => row.name === column)) return;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
}

/**
 * Apply idempotent column migrations for tables created by older versions.
 * @param db Database instance with base tables already present.
 */
function migrateColumns(db: SqliteDb): void {
  addColumnIfMissing(db, "files", "description", "TEXT");
  addColumnIfMissing(db, "files", "reviewed", "TEXT");
  addColumnIfMissing(db, "files", "review_interval", "INTEGER");

  addColumnIfMissing(db, "citations", "published", "TEXT");
  addColumnIfMissing(db, "citations", "verified_at", "TEXT");
  addColumnIfMissing(db, "citations", "trust_class", "TEXT");
}

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

  db.exec(`CREATE TABLE IF NOT EXISTS note_citations (
    file_path TEXT NOT NULL,
    citekey TEXT NOT NULL,
    PRIMARY KEY (file_path, citekey)
  )`);
  db.exec("CREATE INDEX IF NOT EXISTS idx_note_citations_citekey ON note_citations(citekey)");

  migrateColumns(db);
}
