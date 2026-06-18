/**
 * resolve_citation tool — parses a URL or DOI via citation.js for BibTeX citekey.
 *
 * Workflow:
 * 1. Try citation.js to parse the source
 * 2. Generate citekey (lastname-year)
 * 3. Check notes.db dedup via citations table
 * 4. If duplicate → return existing citekey
 * 5. If new → insert into SQLite, append to ref.bib
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { appendFile, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { existsSync } from "node:fs";
import { createDb, initDb, type SqliteDb } from "../db-sqlite.js";

const DB_FILE = "notes.db";
const REF_BIB = "ref.bib";

interface CitationRow {
  citekey: string;
  bibtex: string;
  doi: string | null;
  source_url: string | null;
}

function sanitiseFamily(name: string): string {
  return name.toLowerCase().replace(/[^a-z]/g, "").trim();
}

function proposeCitekey(family: string, year: number): string {
  return `${sanitiseFamily(family)}${year}`;
}

async function resolveCitekey(db: SqliteDb, baseKey: string): Promise<string> {
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

async function tryCitationJs(
  source: string,
): Promise<{ bibtex: string; authorFamily: string; year: number; doi: string | null; url: string | null } | null> {
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
    return { bibtex, authorFamily, year: Number(year), doi: entry.DOI || null, url: entry.URL || null };
  } catch { return null; }
}

function buildMiscEntry(sourceUrl: string, title: string, authors: string[], year: number, accessed: string): string {
  const citekey = proposeCitekey(authors[0]?.split(",")?.[0]?.trim() || "unknown", year);
  return `@misc{${citekey},\n\tauthor = {${authors.join(" and ")}},\n\ttitle = {${title}},\n\turl = {${sourceUrl}},\n\tyear = {${year}},\n\tmonth = {${accessed.slice(0, 7)}},\n\tnote = {Accessed: ${accessed}},\n}\n`;
}

export function registerResolveCitationTool(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "resolve_citation",
    label: "Resolve Citation",
    description:
      "Parse a URL or DOI via citation.js, generate a unique BibTeX citekey, " +
      "deduplicate against the SQLite knowledge base, and append new entries to @ref.bib.",
    promptSnippet:
      "Resolve a citation source: parse via citation.js, check dedup, insert into " +
      "notes.db and append to ref.bib if new.",
    parameters: Type.Object({
      source: Type.String({ description: "DOI or URL to resolve." }),
      title: Type.Optional(Type.String({ description: "Title (needed when citation.js cannot parse the URL)." })),
      authors: Type.Optional(Type.Array(Type.String({ description: "Author names in 'Last, First' format." }))),
      year: Type.Optional(Type.Number({ description: "Publication year for fallback." })),
      accessed: Type.Optional(Type.String({ description: "Access date in ISO 8601 format (defaults to today)." })),
    }),

    async execute(_toolCallId, params, _signal, onUpdate, ctx) {
      const source = params.source.trim();
      const doi = extractDoi(source);
      const now = new Date().toISOString();
      const dbPath = resolve(ctx.cwd, DB_FILE);

      // Create DB if it doesn't exist
      const db = createDb(dbPath);
      initDb(db);

      try {
        onUpdate?.({
          content: [{ type: "text" as const, text: `📖 Resolving citation: ${source}…` }],
          details: {},
        });

        // Check existing by DOI or URL
        let existing: CitationRow[] = [];
        if (doi) {
          existing = db.prepare(
            "SELECT citekey, bibtex, doi, source_url FROM citations WHERE doi = ?",
          ).all<CitationRow>(doi);
        }
        if (existing.length === 0) {
          existing = db.prepare(
            "SELECT citekey, bibtex, doi, source_url FROM citations WHERE source_url = ?",
          ).all<CitationRow>(source);
        }

        if (existing.length > 0) {
          const row = existing[0];
          return {
            content: [{
              type: "text" as const,
              text: `✅ Citation already exists.\nCitekey: @${row.citekey}\n\n\`\`\`bibtex\n${row.bibtex}\n\`\`\``,
            }],
            details: { citekey: row.citekey, bibtex: row.bibtex, isNew: false, doi: row.doi, source_url: row.source_url },
          };
        }

        // Try citation.js
        const parsed = await tryCitationJs(source);
        let bibtex: string;
        let authorFamily: string;
        let year: number;
        let resolvedDoi: string | null = doi;
        let resolvedUrl: string | null = source;

        if (parsed) {
          bibtex = parsed.bibtex;
          authorFamily = parsed.authorFamily;
          year = parsed.year;
          if (parsed.doi) resolvedDoi = parsed.doi;
          if (parsed.url) resolvedUrl = parsed.url;
        } else if (params.title && params.authors && params.authors.length > 0 && params.year) {
          authorFamily = params.authors[0].split(",")?.[0]?.trim() || "unknown";
          year = params.year;
          const accessed = params.accessed || now.slice(0, 10);
          bibtex = buildMiscEntry(source, params.title, params.authors, year, accessed);
          resolvedUrl = source;
        } else {
          return {
            content: [{
              type: "text" as const,
              text: `❌ Could not parse "${source}" via citation.js and no fallback metadata provided.\nProvide: title, authors (array of "Last, First"), year.`,
            }],
            details: { citekey: null, bibtex: null, isNew: false, error: "citation.js parse failed" },
          };
        }

        const baseKey = proposeCitekey(authorFamily, year);
        const citekey = await resolveCitekey(db, baseKey);
        const fixedBibtex = bibtex.replace(/^@\w+\{([^,]+)/, (match: string, oldKey: string) => match.replace(oldKey, citekey));

        // Insert into SQLite
        db.prepare(
          "INSERT INTO citations (citekey, bibtex, doi, source_url, created, updated) VALUES (?, ?, ?, ?, ?, ?)",
        ).run(citekey, fixedBibtex, resolvedDoi, resolvedUrl, now, now);

        // Append to ref.bib
        const refBibPath = resolve(ctx.cwd, REF_BIB);
        let existingBibContent = "";
        try { existingBibContent = await readFile(refBibPath, "utf-8"); } catch { /* ok */ }

        if (!existingBibContent.includes(`@${citekey}`)) {
          const separator = existingBibContent.length > 0 && !existingBibContent.endsWith("\n")
            ? "\n\n" : existingBibContent.length > 0 ? "\n" : "";
          await appendFile(refBibPath, `${separator}${fixedBibtex}\n`, "utf-8");
        }

        return {
          content: [{
            type: "text" as const,
            text: `✅ New citation created.\nCitekey: @${citekey}\nAppended to: ${REF_BIB}\n\n\`\`\`bibtex\n${fixedBibtex}\n\`\`\``,
          }],
          details: { citekey, bibtex: fixedBibtex, isNew: true, doi: resolvedDoi, source_url: resolvedUrl },
        };
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error("[resolve_citation] Error:", msg);
        return {
          content: [{ type: "text" as const, text: `❌ Error: ${msg.slice(0, 200)}` }],
          details: { citekey: null, bibtex: null, isNew: false, error: msg },
        };
      } finally {
        db.close();
      }
    },
  });
}
