/**
 * Citation validation for PARA knowledge documents.
 *
 * Scans markdown content for @citekey references and validates
 * they exist in the SQLite citations table. Used by create_para_doc
 * and batch_create_para_docs as a pre-creation guard.
 *
 * @module common/citation-validation
 */

import type { SqliteDb } from "../extensions/para-knowledge/sqlite-types.js";

// ── Constants ─────────────────────────────────────────────────────────

/**
 * Regex to match @citekey patterns.
 *
 * - Must NOT be preceded by a word character (avoid email-like matches)
 * - The citekey is: a letter followed by letters/digits, or `?` for unresolved placeholders
 * - Must NOT be followed by a word character (stop at punctuation)
 */
const CITATION_REFERENCE_RE = /(?<!\w)@([a-zA-Z][a-zA-Z0-9]*|\?)(?!\w)/g;

// ── Types ─────────────────────────────────────────────────────────────

/** Validation result for citation references found in content. */
export interface ValidationResult {
  /** Whether all referenced citekeys exist in the citations table. */
  valid: boolean;
  /** List of missing or invalid citekeys found in content. */
  missing: string[];
}

// ── Helpers ───────────────────────────────────────────────────────────

/**
 * Strip fenced code blocks and inline code from markdown content.
 * Prevents false positives when @citekey appears inside code.
 */
function stripCodeContent(content: string): string {
  let cleaned = content.replace(/```[\s\S]*?```/g, "");
  cleaned = cleaned.replace(/`[^`]*`/g, "");
  return cleaned;
}

// ── Main export ───────────────────────────────────────────────────────

/**
 * Validate that all @citekey references in content exist in the
 * SQLite citations table.
 *
 * Scans for Pandoc-style citations: narrative @citekey and
 * parenthetical [@citekey]. Rejects @? (unresolved placeholder)
 * and any citekey not found in the DB.
 *
 * Code blocks, inline code, and markdown link URLs are excluded.
 * Email-like patterns (word\w@) are excluded via word-boundary lookbehind.
 *
 * @param content - Markdown body content to scan.
 * @param db      - Open SQLite database handle with citations table.
 * @returns ValidationResult with valid flag and missing list.
 */
export function validateCitations(content: string, db: SqliteDb): ValidationResult {
  const cleaned = stripCodeContent(content);
  const found: string[] = [];
  const seen = new Set<string>();

  let match: RegExpExecArray | null;
  CITATION_REFERENCE_RE.lastIndex = 0;

  while ((match = CITATION_REFERENCE_RE.exec(cleaned)) !== null) {
    const citekey = match[1];

    // Skip if inside a markdown link URL: [text](@citekey)
    const atPos = match.index;
    const preceding = atPos >= 2 ? cleaned.slice(atPos - 2, atPos) : "";
    if (preceding === "](") continue;

    // Deduplicate
    if (seen.has(citekey)) continue;
    seen.add(citekey);

    found.push(citekey);
  }

  // Query each citekey against the citations table
  const missing: string[] = [];
  for (const citekey of found) {
    if (citekey === "?") {
      missing.push(citekey);
      continue;
    }
    const row = db.get<{ citekey: string }>(
      "SELECT citekey FROM citations WHERE citekey = ?",
      citekey,
    );
    if (!row) {
      missing.push(citekey);
    }
  }

  return {
    valid: missing.length === 0,
    missing,
  };
}
