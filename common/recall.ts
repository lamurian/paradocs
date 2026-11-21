/**
 * Deterministic KB recall for the before_agent_start hook.
 *
 * Turns a prompt into a small set of BM25-ranked notes from the existing
 * notes.db index. No LLM calls and no subprocesses: if the lookup is too
 * slow or nothing qualifies, the caller gets no injection at all.
 *
 * @module common/recall
 */

import { DEFAULT_PARADOCS_CONFIG } from "./config.ts";
import { loadFreshness } from "./freshness.ts";
import { buildIdfMap, extractRecallTerms } from "./recall-query.ts";

import type { ParadocsConfig, RecallConfig } from "./config.ts";
import type { SqliteDb } from "../extensions/para-knowledge/sqlite-types.ts";

/** Minimum number of prompt terms required before a recall query runs. */
const MIN_KEPT_TERMS = 3;

/** Multiplier applied to maxHits when fetching candidates from FTS5. */
const CANDIDATE_MULTIPLIER = 4;

/** Configuration accepted by {@link runRecall}. */
export type RecallRunConfig = ParadocsConfig | RecallConfig;

/** A single note selected for injection. */
export interface RecallHit {
  title: string;
  path: string;
  description: string;
  freshness: string;
}

/** Rendered recall block plus the number of injected notes. */
export interface RecallResult {
  block: string;
  hits: number;
}

/** Raw FTS row used while filtering candidates. */
interface RecallRow {
  path: string;
  title: string | null;
  body: string | null;
  description: string | null;
}

/**
 * Check whether recall must be skipped for a prompt.
 *
 * Slash commands are ignored except `/discuss`; any prompt matching one of
 * the configured regular expressions is also skipped. Invalid patterns are
 * ignored rather than throwing.
 *
 * @param prompt - Raw user prompt.
 * @param recallConfig - Recall settings from paradocs.json.
 * @returns True when the prompt should not trigger a KB lookup.
 */
export function shouldSkipRecall(prompt: string, recallConfig: RecallConfig): boolean {
  if (prompt.startsWith("/") && !prompt.startsWith("/discuss")) return true;

  return recallConfig.skipPatterns.some((pattern) => {
    try {
      return new RegExp(pattern).test(prompt);
    } catch {
      return false;
    }
  });
}

/**
 * Check whether the supplied config is a full Paradocs config.
 *
 * @param config - Full configuration or just the recall section.
 * @returns True when recall and freshness sections are both present.
 */
function isParadocsConfig(config: RecallRunConfig): config is ParadocsConfig {
  return "recall" in config && "freshness" in config;
}

/**
 * Resolve a full Paradocs config from either full or recall-only input.
 *
 * @param config - Full configuration or just the recall section.
 * @returns Full configuration with recall and freshness defaults available.
 */
function resolveConfig(config: RecallRunConfig): ParadocsConfig {
  if (isParadocsConfig(config)) return config;
  return { ...DEFAULT_PARADOCS_CONFIG, recall: config };
}

/**
 * Normalize the accepted reference time into a Date.
 *
 * @param now - Date instance or epoch milliseconds.
 * @returns Date used for freshness calculations.
 */
function resolveNow(now: Date | number): Date {
  return now instanceof Date ? now : new Date(now);
}

/**
 * Count how many terms appear in a note's lowercased text.
 *
 * @param haystack - Lowercased title, description and body.
 * @param terms - Lowercase prompt terms.
 * @returns Number of distinct terms contained in the note text.
 */
function countMatchedTerms(haystack: string, terms: string[]): number {
  return terms.filter((term) => haystack.includes(term)).length;
}

/**
 * Render the hidden KB recall block.
 *
 * @param hits - Notes that passed the term threshold, already capped.
 * @returns Markdown block injected as a custom message.
 */
function renderBlock(hits: RecallHit[]): string {
  const lines = ["KB recall (paradocs): existing notes related to this prompt"];
  for (const hit of hits) {
    lines.push(`- ${hit.title} | ${hit.path} | freshness: ${hit.freshness} | ${hit.description}`);
  }
  return lines.join("\n");
}

/**
 * Run a deterministic BM25 recall lookup for a prompt.
 *
 * Returns null when recall is skipped, when fewer than three terms survive
 * extraction, or when no candidate matches at least `minMatchedTerms`.
 * Candidates are fetched with an OR query ordered by FTS5 rank, filtered by
 * lowercase term containment across title, description and body, then cut
 * to `maxHits`.
 *
 * @param prompt - Raw user prompt.
 * @param db - Open notes.db handle.
 * @param config - Full Paradocs config or just its recall section.
 * @param now - Reference instant for freshness status.
 * @returns The rendered block and hit count, or null when nothing qualifies.
 */
export function runRecall(
  prompt: string,
  db: SqliteDb,
  config: RecallRunConfig,
  now: Date | number = new Date(),
): RecallResult | null {
  const fullConfig = resolveConfig(config);
  const { recall } = fullConfig;

  if (shouldSkipRecall(prompt, recall)) return null;

  const terms = extractRecallTerms(prompt, buildIdfMap(db), {
    maxChars: recall.maxChars,
    maxTerms: recall.maxTerms,
  });
  if (terms.length < MIN_KEPT_TERMS) return null;

  const ftsQuery = terms.map((term) => `"${term}"`).join(" OR ");
  const rows = db
    .prepare(
      `SELECT d.path AS path, d.title AS title, d.body AS body, f.description AS description
       FROM docs_fts d
       JOIN files f ON f.path = d.path
       WHERE d.docs_fts MATCH ?
       ORDER BY d.rank
       LIMIT ?`,
    )
    .all<RecallRow>(ftsQuery, recall.maxHits * CANDIDATE_MULTIPLIER);

  const reference = resolveNow(now);
  const hits: RecallHit[] = [];
  for (const row of rows) {
    if (hits.length >= recall.maxHits) break;

    const description = row.description ?? "";
    const haystack = `${row.title ?? ""} ${description} ${row.body ?? ""}`.toLowerCase();
    if (countMatchedTerms(haystack, terms) < recall.minMatchedTerms) continue;

    hits.push({
      title: row.title ?? "",
      path: row.path,
      description,
      freshness: loadFreshness(db, row.path, fullConfig.freshness, reference).status,
    });
  }

  if (hits.length === 0) return null;
  return { block: renderBlock(hits), hits: hits.length };
}
