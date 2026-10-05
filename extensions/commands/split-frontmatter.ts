/**
 * Frontmatter helpers for the /split command: a minimal YAML subset
 * parser (scalars, quoted strings, inline arrays, booleans, numbers)
 * and a formatter for the executive-summary rewrite.
 *
 * @module extensions/commands/split-frontmatter
 */

/**
 * Parse frontmatter from markdown content.
 */
export function parseFrontmatter(content: string): {
  frontmatter: Record<string, unknown>;
  body: string;
} {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return { frontmatter: {}, body: content };
  try {
    const yaml = match[1];
    const frontmatter: Record<string, unknown> = {};
    for (const line of yaml.split("\n")) {
      const [key, ...rest] = line.split(":");
      if (key && rest.length > 0) {
        let value: string | boolean | number = rest.join(":").trim();
        if (value.startsWith("[") && value.endsWith("]")) {
          value = JSON.parse(value) as string | boolean | number;
        } else if (value.startsWith("'") && value.endsWith("'")) {
          value = value.slice(1, -1);
        } else if (value.startsWith('"') && value.endsWith('"')) {
          value = value.slice(1, -1);
        } else if (value === "true" || value === "false") {
          value = value === "true";
        } else if (!isNaN(Number(value))) {
          value = Number(value);
        }
        frontmatter[key.trim()] = value;
      }
    }
    return { frontmatter, body: content.slice(match[0].length + 1).trim() };
  } catch {
    return { frontmatter: {}, body: content };
  }
}

/**
 * Format frontmatter as YAML string.
 */
export function formatFrontmatter(fields: Record<string, unknown>): string {
  const lines = ["---"];
  for (const [key, value] of Object.entries(fields)) {
    if (Array.isArray(value)) {
      lines.push(`${key}: [${value.map((v) => `"${v}"`).join(", ")}]`);
    } else if (typeof value === "string") {
      lines.push(`${key}: "${value}"`);
    } else {
      lines.push(`${key}: ${String(value)}`);
    }
  }
  lines.push("---");
  return lines.join("\n");
}
