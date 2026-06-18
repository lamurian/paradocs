/**
 * YAML frontmatter parsing and formatting for PARA markdown files.
 *
 * Standardised frontmatter fields (in order):
 *   title, description, author, editor, date, tags, source
 *
 * Values with YAML-special characters (colons, hashes, brackets, etc.)
 * are automatically quoted to produce valid YAML.
 */

import type { Frontmatter } from "./types.js";

// ── Constants ───────────────────────────────────────────────────────

/** Ordered field keys for deterministic frontmatter output. */
const FIELD_ORDER = ["title", "description", "author", "editor", "date", "tags", "source"] as const;

// ── YAML quoting helpers ────────────────────────────────────────────

/**
 * Check whether a YAML plain scalar value needs quoting.
 *
 * Returns `true` when the value:
 * - Is empty
 * - Starts with a YAML special character
 * - Contains `: ` or ` #` (ambiguous with mapping or comment)
 * - Looks like a YAML boolean / null / number that should be kept string
 */
function needsYamlQuoting(value: string): boolean {
  if (value.length === 0) return true;

  // Leading special characters that make a plain scalar ambiguous
  if (/^[[\]{},&*!|>'"%@`#:?-]/.test(value)) return true;

  // Contains colon-space or space-hash (ambiguous with mapping/comment)
  if (/: /.test(value) || / #/.test(value)) return true;

  // YAML booleans / nulls / numbers that should remain strings
  if (/^(true|false|yes|no|on|off|null|undefined|~)$/i.test(value)) return true;
  if (/^\d+(\.\d+)?$/.test(value)) return true;

  return false;
}

/**
 * Quote a value for safe YAML output.
 *
 * Strategy:
 * - If the value contains single quotes, wrap in double quotes (escape internal `"`).
 * - Otherwise, wrap in single quotes.
 * - If quoting is not needed, return the value as-is.
 */
export function yamlQuote(value: string): string {
  if (!needsYamlQuoting(value)) return value;

  // Value contains single quote — use double quotes, escape internal double quotes
  if (value.includes("'")) {
    const escaped = value.replace(/"/g, '\\"');
    return `"${escaped}"`;
  }

  // Use single quotes
  return `'${value}'`;
}

// ── Quote aware strip ───────────────────────────────────────────────

/**
 * Strip surrounding quotes from a YAML value if present.
 * Handles single-quoted, double-quoted, and unquoted values.
 * For double-quoted strings, basic escape sequences are resolved.
 */
function unquoteYamlValue(raw: string): string {
  const trimmed = raw.trim();

  // Single-quoted: 'value'  —  no escape processing except '' → '
  if (trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed.slice(1, -1).replace(/''/g, "'");
  }

  // Double-quoted: "value"  —  resolve basic escape sequences
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    const inner = trimmed.slice(1, -1);
    return inner
      .replace(/\\"/g, '"')
      .replace(/\\n/g, "\n")
      .replace(/\\t/g, "\t")
      .replace(/\\\\/g, "\\");
  }

  return trimmed;
}

// ── Parsing ─────────────────────────────────────────────────────────

/**
 * Parse YAML frontmatter from a markdown file's raw content.
 * Returns default values (empty tags) when no frontmatter is found.
 *
 * Handles:
 * - Single / double quoted values
 * - `source`, `source_url`, `url` fields (all normalised to `source_url`)
 * - `description` field
 * - Tag lists under `tags:`
 */
export function parseFrontmatter(content: string): Frontmatter {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return { tags: [] };

  const result: Record<string, unknown> = {};
  const tags: string[] = [];
  let currentKey = "";

  for (const line of match[1].split("\n")) {
    // Match key: value  (accepts alphanumeric + underscore + hyphen keys)
    const kv = line.match(/^([\w_-]+):\s*(.*)/);
    if (kv) {
      currentKey = kv[1];
      const rawVal = kv[2].trim();
      if (rawVal && !rawVal.startsWith("-")) {
        // Unquote the value, then store under the canonical key
        const val = unquoteYamlValue(rawVal);

        // Normalise source aliases to source_url
        if (currentKey === "source" || currentKey === "url") {
          result.source_url = val;
        } else {
          result[currentKey] = val;
        }
      }
    }

    // Tag list items
    const li = line.match(/^\s*-\s+(.+)/);
    if (li && currentKey === "tags") {
      tags.push(unquoteYamlValue(li[1].trim()));
    }
  }

  result.tags = tags;

  const fm = result as unknown as Frontmatter;
  if (typeof result.description === "string") {
    fm.description = result.description as string;
  }

  return fm;
}

// ── Formatting (broken into small helpers for complexity ≤ 15) ──────

function determineSourceValue(fm: Record<string, unknown>): string | undefined {
  if (typeof fm.source === "string" && fm.source) return fm.source;
  if (typeof fm.source_url === "string" && fm.source_url) return fm.source_url;
  return undefined;
}

function emitTags(out: string, tags: unknown): string {
  if (Array.isArray(tags) && tags.length > 0) {
    out += "tags:\n";
    for (const t of tags) {
      out += `  - ${yamlQuote(String(t))}\n`;
    }
  }
  return out;
}

function emitStandardFields(
  out: string,
  fm: Record<string, unknown>,
  sourceVal: string | undefined,
): string {
  for (const key of FIELD_ORDER) {
    if (key === "tags") {
      out = emitTags(out, fm.tags);
    } else if (key === "source") {
      if (sourceVal) {
        out += `source: ${yamlQuote(sourceVal)}\n`;
      }
    } else {
      const v = fm[key];
      if (typeof v === "string" && v) {
        out += `${key}: ${yamlQuote(v)}\n`;
      }
    }
  }
  return out;
}

function emitLegacyFields(
  out: string,
  fm: Record<string, unknown>,
  sourceVal: string | undefined,
): string {
  for (const [k, v] of Object.entries(fm)) {
    if ((FIELD_ORDER as readonly string[]).includes(k as string)) continue;
    if (k === "tags" || k === "source") continue;
    if (typeof v === "string" && v) {
      if ((k === "source_url" || k === "url") && sourceVal) continue;
      out += `${k}: ${yamlQuote(v)}\n`;
    }
  }
  return out;
}

/**
 * Format a key-value map back into YAML frontmatter string.
 *
 * - Emits fields in the standardised order: title, description, author, editor, date, tags, source
 * - Tags are rendered as a block list
 * - String values are automatically quoted when needed
 * - Handles both `source` (new canonical) and `source_url` (legacy alias)
 * - Legacy fields are emitted after the standard fields
 */
export function formatFrontmatter(fm: Record<string, unknown>): string {
  let out = "---\n";
  const sourceVal = determineSourceValue(fm);
  out = emitStandardFields(out, fm, sourceVal);
  out = emitLegacyFields(out, fm, sourceVal);
  return out + "---\n";
}
