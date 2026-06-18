/**
 * Shared types for the SQLite-based PARA Knowledge Extension.
 */

/** Synchronous SQLite statement interface (compatible with bun:sqlite and node:sqlite). */
export interface SqliteStatement {
  run(...params: unknown[]): void;
  all<T = Record<string, unknown>>(...params: unknown[]): T[];
  get<T = Record<string, unknown>>(...params: unknown[]): T | undefined;
}

/** Synchronous SQLite database interface (compatible with bun:sqlite and node:sqlite). */
export interface SqliteDb {
  exec(sql: string): void;
  prepare(sql: string): SqliteStatement;
  close(): void;
  run(sql: string, ...params: unknown[]): void;
  all<T = Record<string, unknown>>(sql: string, ...params: unknown[]): T[];
  get<T = Record<string, unknown>>(sql: string, ...params: unknown[]): T | undefined;
}

/** Metadata for indexing a single document. */
export interface DocIndex {
  path: string;
  title: string;
  body: string;
  tags: string[];
  author: string;
  editor: string;
  created: string | null;
  modified: string | null;
  file_mtime: string | null;
  source_url: string | null;
}

/** A search result returned by FTS5 BM25 search. */
export interface SearchResult {
  path: string;
  title: string;
  body: string;
  author: string;
  editor: string;
  file_mtime: string;
  source_url: string | null;
  description: string | null;
  tags: string[];
  /** BM25 rank from FTS5 (non-positive, lower = more relevant). */
  score: number;
  /** True if the document was found only via tag match (no text overlap). */
  matchedByTag: boolean;
  /** Tags that matched the filter tags. */
  tagMatches: string[];
}

export interface SearchOptions {
  tags?: string[];
}
