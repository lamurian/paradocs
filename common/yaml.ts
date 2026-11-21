/**
 * Shared YAML frontmatter helpers for PARA knowledge documents.
 *
 * Standardised frontmatter fields (in order):
 *   title, description, author, editor, date, tags, source, reviewed,
 *   review_interval
 *
 * Values with YAML-special characters (colons, hashes, brackets, etc.)
 * are automatically quoted to produce valid YAML.
 *
 * This module is used by several extensions and avoids code duplication
 * across batch-create and yaml-enforcer.
 */

const FIELD_ORDER = [
  "title",
  "description",
  "author",
  "editor",
  "date",
  "tags",
  "source",
  "reviewed",
  "review_interval",
] as const;

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
  if (/^[[\]{},&*!|>'"%@`#:?-\s]/.test(value)) return true;
  if (/: /.test(value) || / #/.test(value)) return true;
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

  if (value.includes("'")) {
    const escaped = value.replace(/"/g, '\\"');
    return `"${escaped}"`;
  }

  return `'${value}'`;
}

/** Resolve the source value, preferring `source` over the `source_url` alias. */
function resolveSource(fields: Record<string, unknown>): string | undefined {
  if (typeof fields.source === "string" && fields.source) return fields.source;
  if (typeof fields.source_url === "string" && fields.source_url) return fields.source_url;
  return undefined;
}

/** Render a tags array as a YAML block list, or an empty string when absent. */
function formatTags(value: unknown): string {
  if (!Array.isArray(value) || value.length === 0) return "";
  let out = "tags:\n";
  for (const tag of value) out += `  - ${yamlQuote(String(tag))}\n`;
  return out;
}

/** Render one scalar field line, allowing numbers and quoting strings. */
function formatScalar(key: string, value: unknown): string {
  if (typeof value === "string" && value) return `${key}: ${yamlQuote(value)}\n`;
  if (typeof value === "number" && Number.isFinite(value)) return `${key}: ${value}\n`;
  return "";
}

/**
 * Build standardised YAML frontmatter string from a fields map.
 *
 * - Emits fields in the standardised order
 * - Tags are rendered as a block list
 * - String values are automatically quoted when needed
 * - Numbers are emitted as plain YAML scalars
 * - Handles both `source` (new canonical) and `source_url` (legacy alias)
 */
export function formatFrontmatter(fields: Record<string, unknown>): string {
  let out = "---\n";
  const sourceVal = resolveSource(fields);

  for (const key of FIELD_ORDER) {
    if (key === "tags") out += formatTags(fields.tags);
    else if (key === "source") {
      if (sourceVal) out += `source: ${yamlQuote(sourceVal)}\n`;
    } else out += formatScalar(key, fields[key]);
  }

  return out + "---\n";
}
