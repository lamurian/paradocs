/**
 * FTS5 BM25 search implementation for the SQLite knowledge base.
 *
 * Three search modes:
 * 1. Text-only: FTS5 MATCH with BM25 ranking.
 * 2. Text + tag filter: FTS5 results restricted by tag subquery.
 * 3. Tag-only: When text matches nothing under tag filter, fall back to tag-only.
 */

import type { SqliteDb, SearchResult, SearchOptions } from "./sqlite-types.js";
import { getFileTags } from "./sqlite-indexing.js";

// ── Public search API ──

/**
 * Search indexed documents using FTS5 BM25 ranking with optional tag filtering.
 *
 * Strategy:
 * 1. If query is provided, search FTS5 with BM25 ranking.
 * 2. If tag filter is provided, filter to documents matching any filter tag.
 * 3. If query is empty but tags are provided, return tag-only results.
 * 4. If text query matches nothing under the tag filter, fall back to tag-only.
 */
export function searchDocs(
  db: SqliteDb,
  query: string,
  options: SearchOptions = {},
  maxResults: number = 25,
): SearchResult[] {
  const { tags: filterTags } = options;
  const hasQuery = query.trim().length > 0;
  const hasFilterTags = filterTags !== undefined && filterTags.length > 0;

  if (!hasQuery && hasFilterTags) {
    return searchByTagsOnly(db, filterTags!, maxResults);
  }
  if (hasQuery) {
    return searchByText(db, query, filterTags, maxResults);
  }
  return [];
}

// ── Text search with optional tag filter ──

function searchByText(
  db: SqliteDb,
  query: string,
  filterTags: string[] | undefined,
  maxResults: number,
): SearchResult[] {
  const ftsQuery = buildFts5Query(query);
  if (ftsQuery.length === 0) {
    return filterTags && filterTags.length > 0 ? searchByTagsOnly(db, filterTags, maxResults) : [];
  }

  const results: SearchResult[] = [];

  // Phase 1: FTS5 text match with optional tag filter
  {
    let sql = `
      SELECT d.path, d.title, d.body,
             f.author, f.editor, f.file_mtime, f.source_url,
             d.rank AS bm25_score
      FROM docs_fts d
      JOIN files f ON f.path = d.path
      WHERE d.docs_fts MATCH ?
    `;
    const params: unknown[] = [ftsQuery];

    if (filterTags && filterTags.length > 0) {
      const ph = filterTags.map(() => "?").join(", ");
      sql += ` AND d.path IN (SELECT file_path FROM tags WHERE tag IN (${ph}))`;
      params.push(...filterTags);
    }

    sql += " ORDER BY d.rank";
    const rows = db.prepare(sql).all<Record<string, unknown>>(...params);

    for (const row of rows) {
      results.push(rowToResult(db, row, filterTags));
    }
  }

  // Phase 2: Tag-only fallback — only when text matched nothing
  if (results.length === 0 && filterTags && filterTags.length > 0) {
    results.push(...searchByTagsOnly(db, filterTags, maxResults));
  }

  results.sort(byRelevance);
  return results.slice(0, maxResults);
}

/**
 * Convert a raw FTS5 result row into a SearchResult with tag matching.
 */
function rowToResult(
  db: SqliteDb,
  row: Record<string, unknown>,
  filterTags: string[] | undefined,
): SearchResult {
  const path = row.path as string;
  const matchedTags = filterTags
    ? getFileTags(db, path).filter((t) =>
        filterTags.some((ft) => t.toLowerCase() === ft.toLowerCase()),
      )
    : [];

  return {
    path,
    title: (row.title as string) ?? "",
    body: (row.body as string) ?? "",
    author: (row.author as string) ?? "",
    editor: (row.editor as string) ?? "",
    file_mtime: (row.file_mtime as string) ?? "",
    source_url: (row.source_url as string | null) ?? null,
    description: null,
    tags: getFileTags(db, path),
    score: (row.bm25_score as number) ?? 0,
    matchedByTag: false,
    tagMatches: matchedTags,
  };
}

/**
 * Sort comparator: text-matched results before tag-only, then by BM25 score.
 */
function byRelevance(a: SearchResult, b: SearchResult): number {
  if (a.matchedByTag !== b.matchedByTag) {
    return a.matchedByTag ? 1 : -1;
  }
  return a.score - b.score;
}

// ── Tag-only search ──

function searchByTagsOnly(db: SqliteDb, tags: string[], maxResults: number): SearchResult[] {
  const ph = tags.map(() => "?").join(", ");
  const rows = db
    .prepare(
      `SELECT DISTINCT f.path, f.title, f.author, f.editor, f.file_mtime, f.source_url
     FROM files f
     JOIN tags t ON f.path = t.file_path
     WHERE t.tag IN (${ph})
     ORDER BY f.title
     LIMIT ?`,
    )
    .all<Record<string, unknown>>(...tags, maxResults);

  return rows.map((row) => {
    const path = row.path as string;
    const matchedTags = tags.filter((t) =>
      getFileTags(db, path).some((ft) => ft.toLowerCase() === t.toLowerCase()),
    );
    return {
      path,
      title: (row.title as string) ?? "",
      body: "",
      author: (row.author as string) ?? "",
      editor: (row.editor as string) ?? "",
      file_mtime: (row.file_mtime as string) ?? "",
      source_url: (row.source_url as string | null) ?? null,
      description: null,
      tags: getFileTags(db, path),
      score: 1.0,
      matchedByTag: true,
      tagMatches: matchedTags,
    };
  });
}

// ── Helpers ──

// Stop words filtered from FTS5 queries to avoid impossibly strict AND matches.
const STOP_WORDS = new Set([
  "a",
  "an",
  "the",
  "and",
  "or",
  "but",
  "in",
  "on",
  "at",
  "to",
  "for",
  "of",
  "with",
  "by",
  "is",
  "are",
  "was",
  "were",
  "be",
  "been",
  "being",
  "have",
  "has",
  "had",
  "do",
  "does",
  "did",
  "will",
  "would",
  "could",
  "should",
  "may",
  "might",
  "shall",
  "can",
  "need",
  "dare",
  "ought",
  "used",
  "about",
  "above",
  "after",
  "again",
  "all",
  "also",
  "any",
  "because",
  "before",
  "between",
  "both",
  "each",
  "few",
  "from",
  "here",
  "how",
  "into",
  "just",
  "more",
  "most",
  "no",
  "not",
  "now",
  "only",
  "other",
  "over",
  "per",
  "same",
  "such",
  "than",
  "that",
  "their",
  "them",
  "there",
  "these",
  "they",
  "this",
  "those",
  "through",
  "under",
  "until",
  "very",
  "what",
  "when",
  "where",
  "which",
  "while",
  "who",
  "why",
  "up",
  "down",
  "out",
  "off",
  "about",
  "above",
]);

/**
 * Build an FTS5 match query from a raw string.
 * Removes stop words and single-character terms, then joins with OR.
 * Using OR instead of AND prevents overly strict queries where a single
 * missing term excludes all relevant documents. BM25 ranking naturally
 * prioritises documents that match more of the query terms.
 */
function buildFts5Query(rawQuery: string): string {
  // Replace FTS5-special characters with spaces to prevent syntax errors.
  // FTS5 interprets `.` as column-prefix syntax, `"` for phrase queries,
  // `()` for grouping, `+` `~` `^` `*` for operators, `-` as NOT operator.
  const cleaned = rawQuery.replace(/[."()+~^*/-]/g, " ");
  const terms = cleaned
    .toLowerCase()
    .trim()
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOP_WORDS.has(t));
  if (terms.length === 0) return "";
  return terms.join(" OR ");
}
