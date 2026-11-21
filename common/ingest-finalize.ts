/**
 * Finalization helpers for the ingest path.
 *
 * These helpers keep the order-sensitive parts of ingest in one place:
 * citations are committed before notes are written, auto-linking runs after a
 * note is indexed, and the knowledge base receives exactly one git commit per
 * run with changes.
 *
 * @module common/ingest-finalize
 */

import { basename } from "node:path";

import { autoLink } from "./autoLink.ts";
import { commitCitations } from "./citation-commit.ts";
import { loadParadocsConfig } from "./config.ts";
import { commitKnowledgeBase } from "./gitCommit.ts";

import type { StagedCitation } from "./stage-validate.ts";
import type { SqliteDb } from "../extensions/para-knowledge/sqlite-types.ts";

/** A batch or note that could not be ingested. */
export interface IngestSkip {
  path: string;
  reason: string;
}

/** Summary of one ingest run. */
export interface IngestReport {
  batches: string[];
  created: string[];
  updated: string[];
  skipped: IngestSkip[];
  conflicts: string[];
  /** Absolute parked paths matching each entry in `conflicts`, when known. */
  conflictPaths?: string[];
  citationsAdded: string[];
  commit: string | null;
}

/** Format a list of values as indented markdown bullets. */
function bullets(values: string[]): string[] {
  return values.length > 0 ? values.map((value) => `  - ${value}`) : ["  (none)"];
}

/**
 * Read the configured auto-link cap for ingest.
 *
 * @param knowledgeDir - Directory containing `paradocs.json`.
 * @returns The `note.maxLinks` value, defaulting to 5 when unset or invalid.
 */
export function readIngestMaxLinks(knowledgeDir: string): number {
  return loadParadocsConfig(knowledgeDir).config.note.maxLinks;
}

/**
 * Commit one batch's staged citations before any note is written.
 *
 * @param db - Open writable notes.db handle.
 * @param knowledgeDir - KNOWLEDGE_DIR that owns ref.bib.
 * @param citations - Staged citations from the batch.
 * @returns Citekeys newly added to ref.bib and the citations table.
 */
export async function commitIngestCitations(
  db: SqliteDb,
  knowledgeDir: string,
  citations: StagedCitation[],
): Promise<string[]> {
  if (citations.length === 0) return [];
  const result = await commitCitations(db, knowledgeDir, citations);
  return result.added;
}

/**
 * Append BM25 related-note links to a written and indexed note.
 *
 * @param relPath - Relative note path such as `Resources/alpha.md`.
 * @param title - Note title used for BM25 term expansion.
 * @param tags - Note tags used for BM25 term expansion.
 * @param knowledgeDir - KNOWLEDGE_DIR root that owns the note.
 * @param db - Open writable notes.db handle.
 * @param maxLinks - Maximum number of related links to append.
 * @returns Number of related links appended.
 */
export async function linkIngestedNote(
  relPath: string,
  title: string,
  tags: string[],
  knowledgeDir: string,
  db: SqliteDb,
  maxLinks: number,
): Promise<number> {
  return autoLink(relPath, title, tags, knowledgeDir, db, maxLinks);
}

/**
 * Commit the knowledge base once for an ingest run with changes.
 *
 * @param cwd - Project working directory that owns the outbox.
 * @param report - Accumulated report for the run.
 * @returns The git commit hash, or null when nothing changed or commit failed.
 */
export async function commitIngestRun(cwd: string, report: IngestReport): Promise<string | null> {
  const changed =
    report.created.length > 0 || report.updated.length > 0 || report.citationsAdded.length > 0;
  if (!changed) return null;

  const message = `paradocs: ingest ${report.created.length}+${report.updated.length} notes`;
  const result = await commitKnowledgeBase(message, cwd);
  return result.hash ?? null;
}

/**
 * Render a human-readable ingest report.
 *
 * Lists created and updated notes, skipped entries with reasons, conflicts
 * with their outbox conflict paths, citations added and the final commit.
 *
 * @param report - Report returned by `ingestOutbox`.
 * @returns Multi-line summary text ending in a newline.
 */
export function formatIngestReport(report: IngestReport): string {
  const lines: string[] = [`Ingest report: ${report.batches.length} batch(es)`];

  lines.push("Created:", ...bullets(report.created));
  lines.push("Updated:", ...bullets(report.updated));

  lines.push("Skipped:");
  if (report.skipped.length === 0) {
    lines.push("  (none)");
  } else {
    for (const entry of report.skipped) {
      lines.push(`  - ${entry.path} (${entry.reason})`);
    }
  }

  lines.push("Conflicts:");
  if (report.conflicts.length === 0) {
    lines.push("  (none)");
  } else {
    report.conflicts.forEach((path, index) => {
      const parked =
        report.conflictPaths?.[index] ?? `.pi/paradocs/outbox/.conflicts/${basename(path)}`;
      lines.push(`  - ${path} -> ${parked}`);
    });
  }

  lines.push("Citations added:", ...bullets(report.citationsAdded));
  lines.push(`Commit: ${report.commit ?? "none"}`);

  return `${lines.join("\n")}\n`;
}
