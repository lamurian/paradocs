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

import { configureEnv, getKnowledgeConfig } from "./env.ts";
import { rebuildDb } from "../extensions/para-knowledge/rebuild.ts";
import { createDb, initDb } from "../extensions/para-knowledge/sqlite-init.ts";

import type { SqliteDb } from "../extensions/para-knowledge/sqlite-types.ts";

// ── Lazy singleton ──────────────────────────────────────────────────

/** Cached database handle reused across all callers for the process lifetime. */
let cachedDb: SqliteDb | null = null;

/** Read-only handle cache and the db path it was opened from. */
let cachedReadOnlyDb: SqliteDb | null = null;
let cachedReadOnlyPath: string | null = null;

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

/**
 * Resolve the configured notes.db path.
 *
 * @param cwd - Working directory for env resolution.
 * @returns Absolute path to notes.db.
 */
export function getNotesDbPath(cwd?: string): string {
  configureEnv(cwd);
  const { dir, db: dbName } = getKnowledgeConfig(cwd);
  return resolve(dir, dbName);
}

/**
 * Open the existing notes.db in read-only mode.
 *
 * Never creates the file, never runs `initDb` and never rebuilds the index.
 * The handle is cached per resolved db path for the process lifetime.
 *
 * @param cwd - Working directory for env resolution.
 * @returns A read-only SQLite handle, or null when notes.db is missing.
 */
export function openNotesDbReadOnly(cwd?: string): SqliteDb | null {
  configureEnv(cwd);

  const { dir, db: dbName } = getKnowledgeConfig(cwd);
  const dbPath = resolve(dir, dbName);

  if (cachedReadOnlyDb && cachedReadOnlyPath === dbPath) {
    if (existsSync(dbPath)) return cachedReadOnlyDb;
    // The file vanished after caching — drop the stale handle.
    cachedReadOnlyDb.close();
    cachedReadOnlyDb = null;
    cachedReadOnlyPath = null;
    return null;
  }

  if (!existsSync(dbPath)) return null;

  if (cachedReadOnlyDb) {
    cachedReadOnlyDb.close();
    cachedReadOnlyDb = null;
  }

  cachedReadOnlyDb = createDb(dbPath, { readOnly: true });
  cachedReadOnlyPath = dbPath;
  return cachedReadOnlyDb;
}

/**
 * Build the guidance message shown when notes.db does not exist.
 *
 * @param cwd - Working directory for env resolution.
 * @returns Human-readable explanation naming the missing db path.
 */
export function missingNotesDbMessage(cwd?: string): string {
  return `notes.db not found at ${getNotesDbPath(cwd)}. It is built by the main session (session_start reindex) or /para-ingest.`;
}
