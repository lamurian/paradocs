/**
 * Shared YAML frontmatter helpers for PARA knowledge documents.
 *
 * Standardised frontmatter fields (in order):
 *   title, description, author, editor, date, tags, source
 *
 * Values with YAML-special characters (colons, hashes, brackets, etc.)
 * are automatically quoted to produce valid YAML.
 *
 * This module is used by several extensions and avoids code duplication
 * across batch-create, roadmap-scratchpad, and yaml-enforcer.
 */

const FIELD_ORDER = ["title", "description", "author", "editor", "date", "tags", "source"] as const;

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

/**
 * Build standardised YAML frontmatter string from a fields map.
 *
 * - Emits fields in the standardised order
 * - Tags are rendered as a block list
 * - String values are automatically quoted when needed
 * - Handles both `source` (new canonical) and `source_url` (legacy alias)
 */
export function formatFrontmatter(fields: Record<string, unknown>): string {
  let out = "---\n";

  let sourceVal: string | undefined;
  if (typeof fields.source === "string" && fields.source) sourceVal = fields.source;
  else if (typeof fields.source_url === "string" && fields.source_url)
    sourceVal = fields.source_url;

  for (const key of FIELD_ORDER) {
    if (key === "tags") {
      const v = fields.tags;
      if (Array.isArray(v) && v.length > 0) {
        out += "tags:\n";
        for (const t of v) out += `  - ${yamlQuote(String(t))}\n`;
      }
    } else if (key === "source") {
      if (sourceVal) out += `source: ${yamlQuote(sourceVal)}\n`;
    } else {
      const v = fields[key];
      if (typeof v === "string" && v) out += `${key}: ${yamlQuote(v)}\n`;
    }
  }

  return out + "---\n";
}
