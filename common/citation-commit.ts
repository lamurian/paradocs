/**
 * Citation commit module for the ingest path.
 *
 * Ingest is the only writer of ref.bib and the citations table. This module
 * appends staged citations that are not already known and records their
 * freshness metadata in SQLite.
 *
 * @module common/citation-commit
 */

import { appendFile, readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { loadRefBibCitekeys } from "./citation-validation.ts";

import type { StagedCitation } from "./stage-validate.ts";
import type { SqliteDb } from "../extensions/para-knowledge/sqlite-types.ts";

const REF_BIB = "ref.bib";

/** Outcome of committing a batch of staged citations. */
export interface CitationCommitResult {
  added: string[];
  skipped: string[];
}

/**
 * Insert a BibTeX field before the closing brace unless already present.
 *
 * @param bibtex - BibTeX entry text to modify.
 * @param field - Field name to inject.
 * @param value - Field value to inject.
 * @returns The BibTeX text, unchanged when the field already exists.
 */
export function injectBibtexField(bibtex: string, field: string, value: string): string {
  const fieldRe = new RegExp(`\\b${field}\\s*=`, "i");
  if (fieldRe.test(bibtex)) return bibtex;

  const closeIndex = bibtex.lastIndexOf("}");
  if (closeIndex === -1) return bibtex;

  const head = bibtex.slice(0, closeIndex).replace(/\s+$/, "");
  const needsComma = head.length > 0 && !head.endsWith(",");
  const insertion = `${needsComma ? "," : ""}\n\t${field} = {${value}},`;
  return `${head}${insertion}\n${bibtex.slice(closeIndex)}`;
}

/** Return true when the citations table already holds the citekey. */
function citekeyInDb(db: SqliteDb, citekey: string): boolean {
  const row = db.prepare("SELECT citekey FROM citations WHERE citekey = ?").get(citekey);
  return Boolean(row);
}

/** Build the text appended to ref.bib for one entry. */
function bibBlock(existing: string, bibtex: string): string {
  const trimmed = bibtex.endsWith("\n") ? bibtex : `${bibtex}\n`;
  if (existing.length === 0) return trimmed;
  if (existing.endsWith("\n\n")) return trimmed;
  if (existing.endsWith("\n")) return `\n${trimmed}`;
  return `\n\n${trimmed}`;
}

/**
 * Commit staged citations into ref.bib and the citations table.
 *
 * Citekeys already present in the table or ref.bib are skipped. New entries
 * gain a `verified = {<verified_at>}` field when the staged value is set and
 * the field is missing.
 *
 * @param db - Open writable notes.db handle.
 * @param knowledgeDir - KNOWLEDGE_DIR that owns ref.bib.
 * @param entries - Staged citations from the outbox.
 * @returns Citekeys added and skipped, in input order.
 */
export async function commitCitations(
  db: SqliteDb,
  knowledgeDir: string,
  entries: StagedCitation[],
): Promise<CitationCommitResult> {
  const refBibPath = resolve(knowledgeDir, REF_BIB);
  const bibKeys = loadRefBibCitekeys(knowledgeDir);
  const now = new Date().toISOString();

  let bibContent = "";
  try {
    bibContent = await readFile(refBibPath, "utf8");
  } catch {
    // Missing ref.bib is fine; the first new entry creates it.
  }

  const added: string[] = [];
  const skipped: string[] = [];

  for (const entry of entries) {
    if (bibKeys.has(entry.citekey) || citekeyInDb(db, entry.citekey)) {
      skipped.push(entry.citekey);
      continue;
    }

    let bibtex = entry.bibtex;
    if (entry.verified_at) {
      bibtex = injectBibtexField(bibtex, "verified", entry.verified_at);
    }

    const block = bibBlock(bibContent, bibtex);
    await appendFile(refBibPath, block, "utf8");
    bibContent += block;

    db.prepare(
      `INSERT INTO citations
         (citekey, bibtex, doi, source_url, published, verified_at, trust_class, created, updated)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      entry.citekey,
      bibtex,
      null,
      null,
      entry.published ?? null,
      entry.verified_at ?? null,
      entry.trust_class ?? null,
      now,
      now,
    );

    bibKeys.add(entry.citekey);
    added.push(entry.citekey);
  }

  return { added, skipped };
}
