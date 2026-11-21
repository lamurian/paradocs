/**
 * Shared citation preview module.
 *
 * Parses URLs/DOIs via citation.js, deduplicates against the SQLite
 * citations table, generates unique BibTeX citekeys and enriches the
 * BibTeX with `date`/`urldate` fields. This module never writes ref.bib
 * or notes.db; ingestion commits staged citations separately.
 *
 * @module common/citation
 */

import { injectBibtexField } from "./citation-commit.ts";
import { loadRefBibCitekeys } from "./citation-validation.ts";
import { getKnowledgeConfig } from "./env.ts";
import { openNotesDbReadOnly } from "./notesDb.ts";

import type { SqliteDb } from "../extensions/para-knowledge/db-sqlite.ts";

interface CitationRow {
  citekey: string;
  bibtex: string;
  doi: string | null;
  source_url: string | null;
  published: string | null;
}

interface CitationParsed {
  bibtex: string;
  authorFamily: string;
  year: number;
  doi: string | null;
  url: string | null;
  published: string | null;
}

/** Parameters accepted when resolving a citation preview. */
export interface CitationParams {
  source: string;
  title?: string;
  authors?: string[];
  year?: number;
  accessed?: string;
}

/** Preview result returned to callers; no side effects are performed. */
export interface CitationPreview {
  citekey: string | null;
  bibtex: string | null;
  isNew: boolean;
  doi: string | null;
  source_url: string | null;
  published: string | null;
  error?: string;
}

function sanitiseFamily(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z]/g, "")
    .trim();
}

function proposeCitekey(family: string, year: number): string {
  return `${sanitiseFamily(family)}${year}`;
}

function isCitekeyTaken(db: SqliteDb | null, bibKeys: ReadonlySet<string>, key: string): boolean {
  if (bibKeys.has(key)) return true;
  if (!db) return false;
  const row = db.prepare("SELECT citekey FROM citations WHERE citekey = ?").get(key);
  return Boolean(row);
}

function resolveCitekey(
  db: SqliteDb | null,
  bibKeys: ReadonlySet<string>,
  baseKey: string,
): string {
  if (!isCitekeyTaken(db, bibKeys, baseKey)) return baseKey;
  for (let i = 97; i <= 122; i++) {
    const candidate = `${baseKey}${String.fromCharCode(i)}`;
    if (!isCitekeyTaken(db, bibKeys, candidate)) return candidate;
  }
  return `${baseKey}-${Date.now()}`;
}

function extractDoi(input: string): string | null {
  if (/^10\.\d{4,}/.test(input)) return input;
  const doiMatch = input.match(/doi\.org\/(10\.\d{4,}\/[^\s?#]+)/i);
  if (doiMatch) return doiMatch[1].replace(/\/$/, "");
  return null;
}

function formatIssuedDate(parts: number[] | undefined): string | null {
  if (!parts || parts.length === 0) return null;
  const [year, month, day] = parts;
  if (typeof year !== "number" || !Number.isFinite(year)) return null;
  const pad = (value: number): string => String(value).padStart(2, "0");
  if (typeof month === "number" && typeof day === "number") {
    return `${year}-${pad(month)}-${pad(day)}`;
  }
  if (typeof month === "number") return `${year}-${pad(month)}`;
  return String(year);
}

function replaceCitekey(bibtex: string, citekey: string): string {
  return bibtex.replace(/^@\w+\{([^,\s]+)/, (match: string, oldKey: string) =>
    match.replace(oldKey, citekey),
  );
}

async function tryCitationJs(source: string): Promise<{
  bibtex: string;
  authorFamily: string;
  year: number;
  doi: string | null;
  url: string | null;
  published: string | null;
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
    const dateParts = entry.issued?.["date-parts"]?.[0];
    const year = dateParts?.[0];
    if (!authorFamily || !year) return null;
    return {
      bibtex,
      authorFamily,
      year: Number(year),
      doi: entry.DOI || null,
      url: entry.URL || null,
      published: formatIssuedDate(dateParts),
    };
  } catch {
    return null;
  }
}

function findExistingCitation(
  db: SqliteDb | null,
  doi: string | null,
  source: string,
): CitationRow | null {
  if (!db) return null;
  let existing: CitationRow[] = [];
  if (doi) {
    existing = db
      .prepare("SELECT citekey, bibtex, doi, source_url, published FROM citations WHERE doi = ?")
      .all<CitationRow>(doi);
  }
  if (existing.length === 0) {
    existing = db
      .prepare(
        "SELECT citekey, bibtex, doi, source_url, published FROM citations WHERE source_url = ?",
      )
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
  params: CitationParams,
): Promise<CitationParsed | { error: string }> {
  const parsed = await tryCitationJs(source);
  if (parsed) {
    return {
      bibtex: parsed.bibtex,
      authorFamily: parsed.authorFamily,
      year: parsed.year,
      doi: parsed.doi || doi,
      url: parsed.url || source,
      published: parsed.published,
    };
  }

  if (params.title && params.year) {
    const authors = params.authors && params.authors.length > 0 ? params.authors : ["unknown"];
    const authorFamily = authors[0].split(",")?.[0]?.trim() || "unknown";
    const year = params.year;
    const accessed = params.accessed || new Date().toISOString().slice(0, 10);
    const bibtex = buildMiscEntry(source, params.title, authors, year, accessed);
    return { bibtex, authorFamily, year, doi, url: source, published: String(year) };
  }

  return {
    error:
      `Could not parse "${source}" via citation.js and no fallback metadata provided.` +
      "\nProvide: title and year (authors optional).",
  };
}

/**
 * Preview a citation without writing ref.bib or notes.db.
 *
 * Deduplicates against the citations table (when notes.db exists), produces
 * a citekey unique against both the table and ref.bib, and injects
 * `date = {<published>}` when known plus `urldate = {<accessed>}`.
 *
 * @param params - DOI/URL plus optional fallback metadata.
 * @param options.cwd - Working directory for env config resolution.
 * @returns Preview with citekey, bibtex, dedup flag, metadata and error.
 */
export async function previewCitation(
  params: CitationParams,
  options: { cwd: string },
): Promise<CitationPreview> {
  const source = params.source.trim();
  const doi = extractDoi(source);
  const accessed = params.accessed || new Date().toISOString().slice(0, 10);

  try {
    const db = openNotesDbReadOnly(options.cwd);
    const { dir } = getKnowledgeConfig(options.cwd);
    const bibKeys = loadRefBibCitekeys(dir);

    const existing = findExistingCitation(db, doi, source);
    if (existing) {
      return {
        citekey: existing.citekey,
        bibtex: existing.bibtex,
        isNew: false,
        doi: existing.doi,
        source_url: existing.source_url,
        published: existing.published,
      };
    }

    const parsed = await parseCitationSource(source, doi, params);
    if ("error" in parsed) {
      return {
        citekey: null,
        bibtex: null,
        isNew: false,
        doi: null,
        source_url: null,
        published: null,
        error: parsed.error,
      };
    }

    const baseKey = proposeCitekey(parsed.authorFamily, parsed.year);
    const citekey = resolveCitekey(db, bibKeys, baseKey);
    let bibtex = replaceCitekey(parsed.bibtex, citekey);
    if (parsed.published) bibtex = injectBibtexField(bibtex, "date", parsed.published);
    bibtex = injectBibtexField(bibtex, "urldate", accessed);

    return {
      citekey,
      bibtex,
      isNew: true,
      doi: parsed.doi,
      source_url: parsed.url,
      published: parsed.published,
    };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[previewCitation] Error:", msg);
    return {
      citekey: null,
      bibtex: null,
      isNew: false,
      doi: null,
      source_url: null,
      published: null,
      error: msg,
    };
  }
}
