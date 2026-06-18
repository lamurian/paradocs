/**
 * SQLite database adapter for the PARA Knowledge Extension.
 *
 * Barrel module — re-exports all symbols from sub-modules:
 * - `sqlite-types.ts` — Shared type definitions
 * - `sqlite-init.ts` — Runtime detection, factory, schema init
 * - `sqlite-indexing.ts` — Document insert/update/delete
 * - `sqlite-search.ts` — FTS5 BM25 search
 *
 * Import from this file for all SQLite database operations:
 *
 * ```ts
 * import { createDb, initDb, indexFile, searchDocs } from "./db-sqlite.js";
 * ```
 */

export type { SqliteDb, SqliteStatement } from "./sqlite-types.js";
export type { DocIndex, SearchResult, SearchOptions } from "./sqlite-types.js";
export { createDb, initDb } from "./sqlite-init.js";
export { indexFile, removeFile, recomputeStats } from "./sqlite-indexing.js";
export { searchDocs } from "./sqlite-search.js";
