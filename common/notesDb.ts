/**
 * Shared notes.db auto-provisioning guard.
 *
 * Provides a lazy singleton `ensureNotesDb(cwd)` that checks if the
 * SQLite knowledge base exists at the configured path and rebuilds it
 * from PARA markdown files if missing.
 *
 * @module common/notesDb
 */

import { existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

import { configureEnv, getKnowledgeConfig } from "./env.js";
import { createDb, initDb } from "../extensions/para-knowledge/db-sqlite.js";
import { rebuildDb } from "../extensions/para-knowledge/rebuild.js";

import type { SqliteDb } from "../extensions/para-knowledge/sqlite-types.js";

// ── Lazy singleton ──────────────────────────────────────────────────

/** Cached database handle reused across all callers for the process lifetime. */
let cachedDb: SqliteDb | null = null;

// ── Public API ─────────────────────────────────────────────────────

/**
 * Ensure the notes.db exists and is fully indexed.
 *
 * Lazy singleton — first call checks if the DB file exists at the
 * configured path and rebuilds it from PARA `.md` files if missing.
 * Subsequent calls return the cached handle without re-checking.
 *
 * The returned handle is shared across all callers for the process
 * lifetime. Do **not** close it — the process closes it on exit.
 *
 * @param cwd     - Working directory for env resolution.
 * @param _options - Optional signal for cancellation.
 * @returns An open SQLite database handle.
 */
export async function ensureNotesDb(
  cwd?: string,
  _options?: { signal?: AbortSignal },
): Promise<SqliteDb> {
  if (cachedDb) return cachedDb;

  configureEnv(cwd);

  const { dir, db: dbName } = getKnowledgeConfig(cwd);
  const dbPath = resolve(dir, dbName);

  if (!existsSync(dbPath)) {
    try {
      await rebuildDb(dir);
    } catch {
      // Graceful fallback: return empty DB handle if rebuild fails
      // (e.g. PARA dirs don't exist yet, permissions, disk full).
      mkdirSync(dir, { recursive: true });
      const db = createDb(dbPath);
      initDb(db);
      cachedDb = db;
      return db;
    }
  }

  const db = createDb(dbPath);
  initDb(db);
  cachedDb = db;
  return db;
}
