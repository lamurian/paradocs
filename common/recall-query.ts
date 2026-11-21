/**
 * Deterministic BM25 recall query helpers.
 *
 * Builds an inverse-document-frequency map from the FTS5 index and turns a
 * raw prompt into a short list of KB-relevant search terms. No LLM calls and
 * no subprocesses — pure tokenization plus scoring.
 *
 * @module common/recall-query
 */

import { tokenize } from "./tokenize.ts";

import type { SqliteDb } from "../extensions/para-knowledge/sqlite-types.ts";

/** Default prompt window and term budget used when options are omitted. */
const DEFAULT_MAX_CHARS = 2000;
const DEFAULT_MAX_TERMS = 12;

/** Options controlling prompt term extraction. */
export interface RecallTermsOptions {
  /** Maximum number of prompt characters to inspect. */
  maxChars: number;
  /** Maximum number of terms to return. */
  maxTerms: number;
}

/** Cached IDF map plus the files signature it was built from. */
interface IdfCacheEntry {
  signature: string;
  idf: Map<string, number>;
}

/** Per-database cache so separate handles never share stale maps. */
const idfCache = new WeakMap<SqliteDb, IdfCacheEntry>();

/** Characters stripped from both ends of a whitespace token before filtering. */
const EDGE_PUNCTUATION = /^[,;:!?"'`“”‘’]+|[,;:!?"'`“”‘’]+$/g;

/** Code-style token markers that disqualify a token. */
const CODE_IDENTIFIER = /[.(){}<>=_]/;
/** camelCase detection: a lowercase letter directly followed by uppercase. */
const CAMEL_CASE = /[a-z][A-Z]/;
/** Any digit, which also covers hex literals such as 0x1f. */
const HAS_DIGIT = /\d/;
/** URL matcher removed before token filtering. */
const URL_PATTERN = /https?:\/\/\S+/g;

/**
 * Read the current files-table signature used to invalidate the IDF cache.
 *
 * @param db - Open SQLite database handle.
 * @returns Signature string combining file count and newest mtime.
 */
function readFilesSignature(db: SqliteDb): string {
  const row = db
    .prepare("SELECT COUNT(*) AS count, MAX(file_mtime) AS maxMtime FROM files")
    .get<{ count: number; maxMtime: string | null }>();
  return `${row?.count ?? 0}|${row?.maxMtime ?? ""}`;
}

/**
 * Build (or reuse) an IDF map over every document in the FTS index.
 *
 * Tokenizes the title and body of each `docs_fts` row, computes document
 * frequency per term and scores each term with
 * `ln((N - df + 0.5) / (df + 0.5) + 1)`. The map is cached per database and
 * rebuilt whenever the `files` signature changes.
 *
 * @param db - Open SQLite database handle.
 * @returns Map of term to inverse document frequency.
 */
export function buildIdfMap(db: SqliteDb): Map<string, number> {
  const signature = readFilesSignature(db);
  const cached = idfCache.get(db);
  if (cached && cached.signature === signature) return cached.idf;

  const rows = db
    .prepare("SELECT title, body FROM docs_fts")
    .all<{ title: string | null; body: string | null }>();

  const documentFrequency = new Map<string, number>();
  for (const row of rows) {
    const terms = new Set(tokenize(`${row.title ?? ""} ${row.body ?? ""}`));
    for (const term of terms) {
      documentFrequency.set(term, (documentFrequency.get(term) ?? 0) + 1);
    }
  }

  const total = rows.length;
  const idf = new Map<string, number>();
  for (const [term, df] of documentFrequency) {
    idf.set(term, Math.log((total - df + 0.5) / (df + 0.5) + 1));
  }

  idfCache.set(db, { signature, idf });
  return idf;
}

/**
 * Decide whether a whitespace token is a URL, path or code identifier.
 *
 * @param token - Whitespace-delimited token with edge punctuation stripped.
 * @returns True when the token must be dropped before tokenization.
 */
function isDroppedToken(token: string): boolean {
  if (!token) return true;
  if (token.includes("/") || token.includes("\\")) return true;
  if (token.startsWith("./") || token.startsWith("~")) return true;
  if (CODE_IDENTIFIER.test(token) || CAMEL_CASE.test(token)) return true;
  if (HAS_DIGIT.test(token)) return true;
  return false;
}

/**
 * Extract the highest-value KB terms from a prompt.
 *
 * Only the first `maxChars` characters are inspected. URLs, paths, code
 * identifiers and digit-bearing tokens are dropped, the remainder is
 * tokenized (lowercase, stopwords removed) and deduplicated, terms absent
 * from the IDF map are discarded, and the survivors are sorted by descending
 * IDF (ties alphabetical) before being cut to `maxTerms`.
 *
 * @param prompt - Raw user prompt text.
 * @param idf - IDF map produced by {@link buildIdfMap}.
 * @param options - Optional prompt window and term budget overrides.
 * @returns Terms ordered by descending IDF, at most `maxTerms` long.
 */
export function extractRecallTerms(
  prompt: string,
  idf: Map<string, number>,
  options: Partial<RecallTermsOptions> = {},
): string[] {
  const maxChars = options.maxChars ?? DEFAULT_MAX_CHARS;
  const maxTerms = options.maxTerms ?? DEFAULT_MAX_TERMS;

  const window = prompt.slice(0, maxChars).replace(URL_PATTERN, " ");

  const kept: string[] = [];
  for (const raw of window.split(/\s+/)) {
    const token = raw.replace(EDGE_PUNCTUATION, "");
    if (isDroppedToken(token)) continue;
    kept.push(token);
  }

  const seen = new Set<string>();
  const terms: string[] = [];
  for (const term of tokenize(kept.join(" "))) {
    if (HAS_DIGIT.test(term)) continue;
    if (seen.has(term)) continue;
    seen.add(term);
    if (!idf.has(term)) continue;
    terms.push(term);
  }

  terms.sort((a, b) => {
    const diff = (idf.get(b) ?? 0) - (idf.get(a) ?? 0);
    return diff !== 0 ? diff : a.localeCompare(b);
  });

  return terms.slice(0, maxTerms);
}
