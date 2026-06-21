/**
 * Shared citation resolution module.
 *
 * Parses URLs/DOIs via citation.js, deduplicates against the SQLite
 * citations table, generates unique BibTeX citekeys, and appends new
 * entries to ref.bib.
 *
 * @module common/citation
 */

import { appendFile, readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { configureEnv, getKnowledgeConfig } from "./env.js";
import { createDb, initDb, type SqliteDb } from "../extensions/para-knowledge/db-sqlite.js";

// ── Constants ───────────────────────────────────────────────────────

const REF_BIB = "ref.bib";

// ── Internal types ──────────────────────────────────────────────────

interface CitationRow {
  citekey: string;
  bibtex: string;
  doi: string | null;
  source_url: string | null;
}

interface CitationParsed {
  bibtex: string;
  authorFamily: string;
  year: number;
  doi: string | null;
  url: string | null;
}

// ── Helpers ─────────────────────────────────────────────────────────

function sanitiseFamily(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z]/g, "")
    .trim();
}

function proposeCitekey(family: string, year: number): string {
  return `${sanitiseFamily(family)}${year}`;
}

function resolveCitekey(db: SqliteDb, baseKey: string): string {
  const existing = db.prepare("SELECT citekey FROM citations WHERE citekey = ?").get(baseKey);
  if (!existing) return baseKey;
  for (let i = 97; i <= 122; i++) {
    const candidate = `${baseKey}${String.fromCharCode(i)}`;
    const taken = db.prepare("SELECT citekey FROM citations WHERE citekey = ?").get(candidate);
    if (!taken) return candidate;
  }
  return `${baseKey}-${Date.now()}`;
}

function extractDoi(input: string): string | null {
  if (/^10\.\d{4,}/.test(input)) return input;
  const doiMatch = input.match(/doi\.org\/(10\.\d{4,}\/[^\s?#]+)/i);
  if (doiMatch) return doiMatch[1].replace(/\/$/, "");
  return null;
}

async function tryCitationJs(source: string): Promise<{
  bibtex: string;
  authorFamily: string;
  year: number;
  doi: string | null;
  url: string | null;
} | null> {
  try {
    const { Cite } = await import("@citation-js/core");
    await import("@citation-js/plugin-doi");
    await import("@citation-js/plugin-bibtex");
    await import("@citation-js/plugin-url");
    const cite = await Cite.async(source);
    const bibtex: string = cite.format("bibtex");
    if (!bibtex || !cite.data?.[0]) return null;
    const entry = cite.data[0];
    const authorFamily = entry.author?.[0]?.family;
    const year = entry.issued?.["date-parts"]?.[0]?.[0];
    if (!authorFamily || !year) return null;
    return {
      bibtex,
      authorFamily,
      year: Number(year),
      doi: entry.DOI || null,
      url: entry.URL || null,
    };
  } catch {
    return null;
  }
}

function findExistingCitation(
  db: SqliteDb,
  doi: string | null,
  source: string,
): CitationRow | null {
  let existing: CitationRow[] = [];
  if (doi) {
    existing = db
      .prepare("SELECT citekey, bibtex, doi, source_url FROM citations WHERE doi = ?")
      .all<CitationRow>(doi);
  }
  if (existing.length === 0) {
    existing = db
      .prepare("SELECT citekey, bibtex, doi, source_url FROM citations WHERE source_url = ?")
      .all<CitationRow>(source);
  }
  return existing.length > 0 ? existing[0] : null;
}

function buildMiscEntry(
  sourceUrl: string,
  title: string,
  authors: string[],
  year: number,
  accessed: string,
): string {
  const citekey = proposeCitekey(authors[0]?.split(",")?.[0]?.trim() || "unknown", year);
  return `@misc{${citekey},\n\tauthor = {${authors.join(" and ")}},\n\ttitle = {${title}},\n\turl = {${sourceUrl}},\n\tyear = {${year}},\n\tmonth = {${accessed.slice(0, 7)}},\n\tnote = {Accessed: ${accessed}},\n}\n`;
}

async function parseCitationSource(
  source: string,
  doi: string | null,
  params: {
    title?: string;
    authors?: string[];
    year?: number;
    accessed?: string;
  },
): Promise<CitationParsed | { error: string }> {
  const parsed = await tryCitationJs(source);
  if (parsed) {
    return {
      bibtex: parsed.bibtex,
      authorFamily: parsed.authorFamily,
      year: parsed.year,
      doi: parsed.doi || doi,
      url: parsed.url || source,
    };
  }

  if (params.title && params.authors && params.authors.length > 0 && params.year) {
    const authorFamily = params.authors[0].split(",")?.[0]?.trim() || "unknown";
    const year = params.year;
    const accessed = params.accessed || new Date().toISOString().slice(0, 10);
    const bibtex = buildMiscEntry(source, params.title, params.authors, year, accessed);
    return { bibtex, authorFamily, year, doi, url: source };
  }

  return {
    error:
      `Could not parse "${source}" via citation.js and no fallback metadata provided.` +
      '\nProvide: title, authors (array of "Last, First"), year.',
  };
}

// ── Exports ─────────────────────────────────────────────────────────

/**
 * Resolve a citation source: parse via citation.js, check dedup against
 * SQLite, generate a unique citekey, and append new entries to ref.bib.
 *
 * @param params.source  - DOI or URL to resolve.
 * @param params.title   - Title (needed when citation.js cannot parse).
 * @param params.authors - Author names in "Last, First" format.
 * @param params.year    - Publication year.
 * @param params.accessed - Access date in ISO 8601 (defaults to today).
 * @param options.cwd    - Working directory for env config resolution.
 * @returns Object with citekey, bibtex, isNew, doi, source_url, and
 *          optionally error on failure.
 */
export async function resolveCitation(
  params: {
    source: string;
    title?: string;
    authors?: string[];
    year?: number;
    accessed?: string;
  },
  options: { cwd: string },
): Promise<{
  citekey: string | null;
  bibtex: string | null;
  isNew: boolean;
  doi: string | null;
  source_url: string | null;
  error?: string;
}> {
  // Ensure .env is loaded
  configureEnv(options.cwd);

  const source = params.source.trim();
  const doi = extractDoi(source);
  const now = new Date().toISOString();
  const { dir, db: dbName } = getKnowledgeConfig(options.cwd);
  const dbPath = resolve(dir, dbName);

  const db = createDb(dbPath);
  initDb(db);

  try {
    // Check for existing citation
    const existing = findExistingCitation(db, doi, source);
    if (existing) {
      return {
        citekey: existing.citekey,
        bibtex: existing.bibtex,
        isNew: false,
        doi: existing.doi,
        source_url: existing.source_url,
      };
    }

    // Try to parse the citation
    const parsed = await parseCitationSource(source, doi, params);
    if ("error" in parsed) {
      return {
        citekey: null,
        bibtex: null,
        isNew: false,
        doi: null,
        source_url: null,
        error: parsed.error,
      };
    }

    const baseKey = proposeCitekey(parsed.authorFamily, parsed.year);
    const citekey = resolveCitekey(db, baseKey);
    const fixedBibtex = parsed.bibtex.replace(/^@\w+\{([^,]+)/, (match: string, oldKey: string) =>
      match.replace(oldKey, citekey),
    );

    // Insert into SQLite
    db.prepare(
      "INSERT INTO citations (citekey, bibtex, doi, source_url, created, updated) VALUES (?, ?, ?, ?, ?, ?)",
    ).run(citekey, fixedBibtex, parsed.doi, parsed.url, now, now);

    // Append to ref.bib
    const refBibPath = resolve(dir, REF_BIB);
    let existingBibContent = "";
    try {
      existingBibContent = await readFile(refBibPath, "utf-8");
    } catch {
      /* ok */
    }

    if (!existingBibContent.includes(`@${citekey}`)) {
      const separator =
        existingBibContent.length > 0 && !existingBibContent.endsWith("\n")
          ? "\n\n"
          : existingBibContent.length > 0
            ? "\n"
            : "";
      await appendFile(refBibPath, `${separator}${fixedBibtex}\n`, "utf-8");
    }

    return {
      citekey,
      bibtex: fixedBibtex,
      isNew: true,
      doi: parsed.doi,
      source_url: parsed.url,
    };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[resolveCitation] Error:", msg);
    return {
      citekey: null,
      bibtex: null,
      isNew: false,
      doi: null,
      source_url: null,
      error: msg,
    };
  } finally {
    db.close();
  }
}
