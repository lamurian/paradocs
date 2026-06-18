/**
 * Shared types for the PARA Knowledge Extension.
 */

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

/** The three PARA categories scanned by the index. */
export const PARA_DIRS = ["Areas", "Projects", "Resources"] as const;
export type ParaDir = (typeof PARA_DIRS)[number];

/** SQLite database file name (relative to project root). */
export const DB_FILE = "notes.db";

/** Parsed YAML frontmatter from a markdown file. */
export interface Frontmatter {
  tags: string[];
  title?: string;
  /** Brief summary ≤ 200 characters, enriches BM25 search. */
  description?: string;
  author?: string;
  editor?: string;
  /** Standard YAML frontmatter date field (ISO 8601). */
  date?: string;
  /** Legacy alias for date, kept for backward compatibility. */
  created?: string;
  modified?: string;
  /** Original source URL the document summarises (optional). */
  source_url?: string;
}

/** A markdown file discovered on the filesystem. */
export interface FileEntry {
  /** Relative path e.g. "Projects/foo.md" */
  path: string;
  /** Absolute filesystem path. */
  absPath: string;
  /** Last modification timestamp (ms since epoch). */
  mtimeMs: number;
}

/** Parsed contents of a markdown file. */
export interface ParsedFile {
  title: string;
  body: string;
  tags: string[];
  author: string;
  editor: string;
  created: string | null;
  /** Brief summary ≤ 200 characters, enriches BM25 search. */
  description: string | null;
  /** Original source URL the document summarises (optional). */
  source_url: string | null;
}

/** A search result returned by BM25 or tag-only search. */
export interface SearchResult {
  path: string;
  title: string;
  body: string;
  author: string;
  editor: string;
  file_mtime: string;
  /** Brief summary ≤ 200 characters, enriches BM25 search. */
  description: string | null;
  /** Original source URL the document summarises (optional). */
  source_url: string | null;
  /** Combined BM25 + tag-boost score. */
  score: number;
  /** Whether the document was found only via tag match (no text overlap). */
  matchedByTag: boolean;
  /** Tags that matched query terms. */
  tagMatches: string[];
}

/** Options for withDb(). */
export interface WithDbOptions {
  ctx?: ExtensionContext;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onUpdate?: (update: any) => void;
  noQueue?: boolean;
}

/** Default BM25 parameters. */
export const BM25_DEFAULTS = {
  /** BM25 k1 term-frequency saturation parameter. */
  K1: 1.2,
  /** BM25 b length-normalization parameter. */
  B: 0.75,
  /** Score boost per matching tag. */
  TAG_BOOST: 1.5,
  /** How many times to repeat the title when tokenizing (boosts title terms). */
  TITLE_BOOST: 3,
  /** Maximum results to return from a search. */
  MAX_RESULTS: 25,
} as const;

/** DuckDB error message indicating an aborted transaction needs rollback. */
export const TX_ABORTED_MSG = "Current transaction is aborted (please ROLLBACK)";
