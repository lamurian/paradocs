/**
 * Deterministic freshness scoring for PARA notes.
 *
 * Freshness combines a note's review metadata, the newest published date
 * among its cited sources, the latest citation verification and the note's
 * own modification date. All calculations are pure except `loadFreshness`,
 * which reads an already-built notes.db index.
 */

import type { FreshnessConfig } from "./config.ts";
import type { SqliteDb } from "../extensions/para-knowledge/sqlite-types.ts";

/** Raw inputs used to compute a freshness verdict. */
export interface FreshnessInput {
  tags: string[];
  reviewed: string | null;
  reviewInterval: number | null;
  noteModified: string | null;
  citedPublished: (string | null)[];
  citedVerifiedAt: (string | null)[];
}

/** Freshness verdict plus the dates it was derived from. */
export interface Freshness {
  status: "fresh" | "aging" | "stale" | "unknown";
  basis: "reviewed" | "source" | "verified" | "modified" | null;
  ageDays: number | null;
  windowDays: number | null;
  reviewed: string | null;
  newestSourcePublished: string | null;
  lastVerified: string | null;
  noteModified: string | null;
}

/** Milliseconds in one day. */
const DAY_MS = 24 * 60 * 60 * 1000;

/** Fraction of a window after which a note becomes aging. */
const AGING_RATIO = 0.75;

/** Row shape read from the files table. */
interface FileRow {
  reviewed: string | null;
  review_interval: number | null;
  modified: string | null;
}

/** Row shape read from the tags table. */
interface TagRow {
  tag: string;
}

/** Row shape read from note_citations joined with citations. */
interface CitationDateRow {
  published: string | null;
  verified_at: string | null;
}

/**
 * Parse a partial ISO date (YYYY, YYYY-MM or YYYY-MM-DD) as UTC midnight.
 *
 * Missing month and day pad to the first day of the period. Full ISO
 * timestamps are accepted by using their date portion only.
 *
 * @param value - Date string from frontmatter, BibTeX or the files table.
 * @returns Epoch milliseconds, or null when the value is missing or invalid.
 */
export function parseDate(value: string | null): number | null {
  if (!value) return null;
  const match = value.trim().match(/^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?/);
  if (!match) return null;

  const year = Number(match[1]);
  const month = match[2] === undefined ? 1 : Number(match[2]);
  const day = match[3] === undefined ? 1 : Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;

  return Date.UTC(year, month - 1, day);
}

/** Whole days between an epoch date and `now`, rounded down. */
function ageInDays(dateMs: number, now: Date): number {
  return Math.floor((now.getTime() - dateMs) / DAY_MS);
}

/** Return the raw value with the greatest parsed date, or null. */
function newestOf(values: (string | null)[]): { raw: string | null; ms: number | null } {
  let raw: string | null = null;
  let ms: number | null = null;
  for (const value of values) {
    const parsed = parseDate(value);
    if (parsed === null) continue;
    if (ms === null || parsed > ms) {
      ms = parsed;
      raw = value;
    }
  }
  return { raw, ms };
}

/**
 * Resolve the freshness window in days.
 *
 * Precedence: an explicit positive `reviewInterval`, then the smallest
 * numeric window among the tags present in `tagWindows` (null when every
 * matching tag maps to null), then `defaultWindowDays`.
 *
 * @param tags - Tags attached to the note.
 * @param reviewInterval - Per-note review interval in days.
 * @param freshnessConfig - Configured default and per-tag windows.
 * @returns Window in days, or null when the note never goes stale.
 */
export function resolveWindowDays(
  tags: string[],
  reviewInterval: number | null,
  freshnessConfig: FreshnessConfig,
): number | null {
  if (reviewInterval !== null && Number.isFinite(reviewInterval) && reviewInterval > 0) {
    return reviewInterval;
  }

  const matched = tags
    .filter((tag) => Object.prototype.hasOwnProperty.call(freshnessConfig.tagWindows, tag))
    .map((tag) => freshnessConfig.tagWindows[tag]);

  if (matched.length > 0) {
    const numeric = matched.filter((value): value is number => typeof value === "number");
    if (numeric.length === 0) return null;
    return Math.min(...numeric);
  }

  return freshnessConfig.defaultWindowDays;
}

/** Map an age and window to a status label. */
function statusFor(ageDays: number, windowDays: number | null): Freshness["status"] {
  if (windowDays === null) return "fresh";
  if (ageDays > windowDays) return "stale";
  if (ageDays > AGING_RATIO * windowDays) return "aging";
  return "fresh";
}

/**
 * Compute a freshness verdict from already-loaded note metadata.
 *
 * Age is measured from the first available basis date: the last review,
 * then the newest cited publication, then the latest verification, then
 * the note's modification date.
 *
 * @param input - Tags, review metadata and citation dates.
 * @param freshnessConfig - Configured default and per-tag windows.
 * @param now - Reference instant for the age calculation.
 * @returns The freshness verdict and the dates behind it.
 */
export function computeFreshness(
  input: FreshnessInput,
  freshnessConfig: FreshnessConfig,
  now: Date,
): Freshness {
  const newestSource = newestOf(input.citedPublished);
  const lastVerified = newestOf(input.citedVerifiedAt);
  const windowDays = resolveWindowDays(input.tags, input.reviewInterval, freshnessConfig);

  let basis: Freshness["basis"] = null;
  let basisMs: number | null = null;

  const reviewedMs = parseDate(input.reviewed);
  const modifiedMs = parseDate(input.noteModified);

  if (reviewedMs !== null) {
    basis = "reviewed";
    basisMs = reviewedMs;
  } else if (newestSource.ms !== null) {
    basis = "source";
    basisMs = newestSource.ms;
  } else if (lastVerified.ms !== null) {
    basis = "verified";
    basisMs = lastVerified.ms;
  } else if (modifiedMs !== null) {
    basis = "modified";
    basisMs = modifiedMs;
  }

  const ageDays = basisMs === null ? null : ageInDays(basisMs, now);
  const status = ageDays === null ? "unknown" : statusFor(ageDays, windowDays);

  return {
    status,
    basis,
    ageDays,
    windowDays,
    reviewed: input.reviewed,
    newestSourcePublished: newestSource.raw,
    lastVerified: lastVerified.raw,
    noteModified: input.noteModified,
  };
}

/**
 * Load note metadata and citation dates from notes.db, then compute freshness.
 *
 * Reads the note's row from `files`, its tags, and its citations via
 * `note_citations JOIN citations`. Missing rows are treated as absent dates.
 *
 * @param db - Open SQLite notes.db handle.
 * @param path - Note path as stored in the index (for example `Projects/x.md`).
 * @param freshnessConfig - Configured default and per-tag windows.
 * @param now - Reference instant for the age calculation.
 * @returns The freshness verdict for the indexed note.
 */
export function loadFreshness(
  db: SqliteDb,
  path: string,
  freshnessConfig: FreshnessConfig,
  now: Date,
): Freshness {
  const file = db
    .prepare("SELECT reviewed, review_interval, modified FROM files WHERE path = ?")
    .get<FileRow>(path);
  const tags = db
    .prepare("SELECT tag FROM tags WHERE file_path = ? ORDER BY tag")
    .all<TagRow>(path)
    .map((row) => row.tag);
  const citations = db
    .prepare(
      `SELECT c.published AS published, c.verified_at AS verified_at
       FROM note_citations nc
       JOIN citations c ON c.citekey = nc.citekey
       WHERE nc.file_path = ?`,
    )
    .all<CitationDateRow>(path);

  return computeFreshness(
    {
      tags,
      reviewed: file?.reviewed ?? null,
      reviewInterval: file?.review_interval ?? null,
      noteModified: file?.modified ?? null,
      citedPublished: citations.map((row) => row.published),
      citedVerifiedAt: citations.map((row) => row.verified_at),
    },
    freshnessConfig,
    now,
  );
}
