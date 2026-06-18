/**
 * YAML frontmatter analysis for yaml-enforcer.
 * Detects invalid YAML, unquoted values, non-standard field names.
 */

interface FrontmatterIssue {
  type: "invalid-yaml" | "needs-quoting" | "nonstandard-field" | "missing-field";
  field?: string;
  message: string;
  suggestion?: string;
}

interface FrontmatterAnalysis {
  hasFrontmatter: boolean;
  rawBlock: string;
  bodyStart: number;
  fields: Record<string, string | string[]>;
  issues: FrontmatterIssue[];
  keyOrder: string[];
}

const STANDARD_FIELDS = [
  "title",
  "description",
  "author",
  "editor",
  "date",
  "tags",
  "source",
] as const;
const FIELD_ALIASES: Record<string, string> = {
  source_url: "source",
  url: "source",
  created: "date",
};

const YAML_NEEDS_QUOTE = /^[[\]{},&*!|>'"%@`#:?-]/;
const YAML_BOOL_LIKE = /^(true|false|yes|no|on|off|null|undefined|~)$/i;
const YAML_NUMBER = /^\d+(\.\d+)?$/;

function needsYamlQuoting(value: string): boolean {
  if (value.length === 0) return true;
  if (YAML_NEEDS_QUOTE.test(value)) return true;
  if (/: /.test(value)) return true;
  if (YAML_BOOL_LIKE.test(value)) return true;
  if (YAML_NUMBER.test(value)) return true;
  return false;
}

function yamlQuote(value: string): string {
  if (!needsYamlQuoting(value)) return value;
  if (value.includes("'")) return `"${value.replace(/"/g, '\\"')}"`;
  return `'${value}'`;
}

function isQuoted(value: string): boolean {
  const trimmed = value.trim();
  return (
    (trimmed.startsWith("'") && trimmed.endsWith("'")) ||
    (trimmed.startsWith('"') && trimmed.endsWith('"'))
  );
}

function normalizeDate(dateStr: string): string | null {
  try {
    const d = new Date(dateStr);
    if (!isNaN(d.getTime())) return d.toISOString();
  } catch {
    /* ignore */
  }
  return null;
}

export function analyzeFrontmatter(content: string): FrontmatterAnalysis {
  const result: FrontmatterAnalysis = {
    hasFrontmatter: false,
    rawBlock: "",
    bodyStart: 0,
    fields: {},
    issues: [],
    keyOrder: [],
  };

  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) {
    result.issues.push({
      type: "invalid-yaml",
      message: "No YAML frontmatter block found (missing --- delimiters)",
    });
    return result;
  }

  result.hasFrontmatter = true;
  result.rawBlock = match[1];
  result.bodyStart = match[0].length;

  const lines = match[1].split("\n");
  let currentKey = "";

  for (let i = 0; i < lines.length; i++) {
    currentKey = processLine(lines[i], currentKey, result);
  }

  checkMissingFields(result);
  return result;
}

/* eslint-disable-next-line complexity */
export async function repairFileFrontmatter(
  readFile: (p: string) => Promise<string>,
  writeFile: (p: string, c: string) => Promise<void>,
  filePath: string,
): Promise<{ fixed: boolean; changes: string[]; content: string | null }> {
  const content = await readFile(filePath);
  const analysis = analyzeFrontmatter(content);

  if (!analysis.hasFrontmatter || analysis.issues.length === 0) {
    return { fixed: false, changes: [], content: null };
  }

  const now = new Date().toISOString();
  const fields: Record<string, unknown> = {};

  for (const key of analysis.keyOrder) {
    const canonical = FIELD_ALIASES[key] ?? key;
    const rawVal = analysis.fields[key];
    if (rawVal !== undefined && !key.startsWith("tags")) {
      const val = typeof rawVal === "string" ? rawVal.replace(/^['"]|['"]$/g, "") : rawVal;
      if (canonical === "date") fields[canonical] = normalizeDate(val as string) || now;
      else if (canonical !== "tags") fields[canonical] = val;
    }
  }

  const existingTags = analysis.fields.tags;
  if (Array.isArray(existingTags) && existingTags.length > 0) fields.tags = existingTags;
  if (!fields.title) fields.title = "";
  if (!fields.author) fields.author = "pi";
  if (!fields.editor) fields.editor = "lam";
  if (!fields.date) fields.date = now;

  const newFrontmatter = buildStandardFrontmatter(fields);

  const bodyEndMatch = content.match(/^---\n[\s\S]*?\n---\n?/);
  const body = bodyEndMatch ? content.slice(bodyEndMatch[0].length).trim() : content.trim();
  const newContent = newFrontmatter + "\n" + body;
  const changes = buildRepairChanges(analysis.issues);
  return { fixed: true, changes, content: newContent };
}

function buildRepairChanges(issues: FrontmatterIssue[]): string[] {
  const changes: string[] = [];
  for (const issue of issues) {
    if (issue.type === "needs-quoting") changes.push(`Quoted value for '${issue.field}'`);
    else if (issue.type === "nonstandard-field")
      changes.push(`Renamed '${issue.field}' -> standardised name`);
    else if (issue.type === "missing-field" && issue.field !== "description")
      changes.push(`Added missing field '${issue.field}'`);
  }
  return changes;
}

function emitStandardField(
  key: string,
  fields: Record<string, unknown>,
  sourceVal: string | undefined,
): string {
  if (key === "tags") {
    const v = fields.tags;
    if (Array.isArray(v) && v.length > 0) {
      let out = "tags:\n";
      for (const t of v) out += `  - ${yamlQuote(String(t))}\n`;
      return out;
    }
    return "";
  }
  if (key === "source") {
    if (sourceVal) return `source: ${yamlQuote(sourceVal)}\n`;
    return "";
  }
  if (key === "date") {
    const v = fields.date || fields.created || fields.modified || new Date().toISOString();
    if (typeof v === "string" && v) return `date: ${yamlQuote(v)}\n`;
    return "";
  }
  const v = fields[key];
  if (typeof v === "string" && v) return `${key}: ${yamlQuote(v)}\n`;
  return "";
}

function buildStandardFrontmatter(fields: Record<string, unknown>): string {
  let out = "---\n";
  const sourceVal =
    typeof fields.source === "string" && fields.source
      ? fields.source
      : typeof fields.source_url === "string" && fields.source_url
        ? fields.source_url
        : undefined;

  for (const key of STANDARD_FIELDS) {
    out += emitStandardField(key, fields, sourceVal);
  }

  for (const [k, v] of Object.entries(fields)) {
    if ((STANDARD_FIELDS as readonly string[]).includes(k as string)) continue;
    if (k === "source_url" || k === "url") continue;
    if (typeof v === "string" && v) out += `${k}: ${yamlQuote(v)}\n`;
  }

  return out + "---";
}

export type { FrontmatterIssue, FrontmatterAnalysis };

function processLine(line: string, currentKey: string, result: FrontmatterAnalysis): string {
  const kv = line.match(/^([\w_-]+):\s*(.*)/);
  if (kv) {
    currentKey = kv[0].trim();
    const key = kv[1];
    const rawVal = kv[2].trim();
    result.keyOrder.push(key);

    if (rawVal && !rawVal.startsWith("-")) {
      const val = rawVal.replace(/^['"]|['"]$/g, "");
      if (needsYamlQuoting(val) && !isQuoted(rawVal)) {
        result.issues.push({
          type: "needs-quoting",
          field: key,
          message: `Value for '${key}' contains YAML-special characters and needs quoting`,
          suggestion: `${key}: ${yamlQuote(val)}`,
        });
      }
      const canonical = FIELD_ALIASES[key];
      if (canonical) {
        result.issues.push({
          type: "nonstandard-field",
          field: key,
          message: `'${key}' should be renamed to '${canonical}' (standardised field)`,
          suggestion: `Replace '${key}: ...' with '${canonical}: ...'`,
        });
      }
      if (!result.fields[key]) result.fields[key] = rawVal;
    }
  }

  const li = line.match(/^\s*-\s+(.+)/);
  if (li && currentKey.startsWith("tags")) {
    if (!Array.isArray(result.fields.tags)) result.fields.tags = [];
    (result.fields.tags as string[]).push(li[1].trim());
  }
  return currentKey;
}

function checkMissingFields(result: FrontmatterAnalysis): void {
  const presentKeys = new Set(result.keyOrder);
  for (const field of STANDARD_FIELDS) {
    if (field === "tags" || field === "source") continue;
    if (!presentKeys.has(field)) {
      result.issues.push({
        type: "missing-field",
        field,
        message: `Standard field '${field}' is missing`,
        suggestion: `Add '${field}: ...' to the frontmatter`,
      });
    }
  }
  if (!presentKeys.has("description")) {
    result.issues.push({
      type: "missing-field",
      field: "description",
      message: "Recommended field 'description' is missing",
      suggestion: "Add 'description: Short summary...'",
    });
  }
}
