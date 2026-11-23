/**
 * Knowledge-base coverage evaluation for evidence gathering.
 *
 * Gates a query's top KB hits with the lexical relevance scorer, then decides
 * whether the KB covers the query without a web search. A query is covered
 * only when it is not forced, at least one hit passes the gate, and every
 * accepted hit is fresh.
 *
 * @module common/gather-kb
 */

import { DEFAULT_PARADOCS_CONFIG } from "./config.ts";
import { parseDate } from "./freshness.ts";
import { gateByRelevance } from "./relevance-gate.ts";
import { createLexicalScorer } from "./relevance.ts";

import type { RelevanceConfig } from "./config-relevance.ts";
import type { EvidencePackQuery } from "./evidence-cache.ts";
import type { Freshness } from "./freshness.ts";
import type { RelevanceDoc } from "./relevance.ts";

/** Maximum number of KB hits considered and listed per query. */
export const KB_HITS_PER_QUERY = 5;

/** One knowledge-base hit returned by the injected `searchKb`. */
export interface GatherKbHit {
  path: string;
  title: string;
  description: string;
  freshness: Freshness;
  tags?: string[];
  body?: string;
}

/** Options controlling KB relevance gating. */
export interface KbCoverageOptions {
  force?: boolean;
  idf?: (term: string) => number;
  relevance?: RelevanceConfig;
}

/** Coverage verdict and the gated KB hits for one query. */
export interface KbQueryCoverage {
  kbCovered: boolean;
  since: string | null;
  kbHits: EvidencePackQuery["kbHits"];
}

/**
 * Map a KB hit to the relevance document used for gating.
 *
 * @param hit - KB hit under evaluation.
 * @returns Strong fields (title, description, tags, path) plus the body.
 */
function toRelevanceDoc(hit: GatherKbHit): RelevanceDoc {
  return {
    strong: [hit.title, hit.description, ...(hit.tags ?? []), hit.path],
    body: hit.body,
  };
}

/**
 * Find the newest source date among accepted non-fresh hits.
 *
 * @param hits - Accepted KB hits for one query.
 * @returns Raw newest date string, or null when none is known.
 */
function newestStaleSourceDate(hits: GatherKbHit[]): string | null {
  let raw: string | null = null;
  let best: number | null = null;
  for (const hit of hits) {
    if (hit.freshness.status === "fresh") continue;
    const value = hit.freshness.newestSourcePublished;
    const parsed = parseDate(value);
    if (parsed === null) continue;
    if (best === null || parsed > best) {
      best = parsed;
      raw = value;
    }
  }
  return raw;
}

/**
 * Gate a query's top KB hits and decide whether the KB covers the query.
 *
 * The top {@link KB_HITS_PER_QUERY} hits are scored with the lexical scorer
 * using the configured threshold, body weight and IDF function, then cut by
 * the configured relative cut. Every hit is reported with its score and
 * whether it passed the gate, in retrieval order.
 *
 * @param query - Search query.
 * @param hits - KB hits in retrieval order.
 * @param options - Force flag, IDF function and relevance config overrides.
 * @returns Coverage verdict, `since` date and the listed KB hits.
 */
export function evaluateKbCoverage(
  query: string,
  hits: GatherKbHit[],
  options: KbCoverageOptions = {},
): KbQueryCoverage {
  const relevance = options.relevance ?? DEFAULT_PARADOCS_CONFIG.relevance;
  const idf = options.idf ?? (() => 1);
  const top = hits.slice(0, KB_HITS_PER_QUERY);

  const scorer = createLexicalScorer({
    threshold: relevance.kbThreshold,
    bodyWeight: relevance.bodyWeight,
    idf,
  });
  const gated = gateByRelevance(query, top, toRelevanceDoc, {
    scorers: [scorer],
    relativeCut: relevance.relativeCut,
    maxHits: KB_HITS_PER_QUERY,
  });

  const scoreByHit = new Map<GatherKbHit, number>(
    [...gated.accepted, ...gated.rejected].map((entry) => [entry.item, entry.score] as const),
  );
  const acceptedSet = new Set(gated.accepted.map((entry) => entry.item));
  const accepted = gated.accepted.map((entry) => entry.item);

  const kbHits = top.map((hit) => {
    const score = scoreByHit.get(hit) ?? 0;
    return {
      path: hit.path,
      title: hit.title,
      freshness: hit.freshness.status,
      relevance: score,
      relevant: acceptedSet.has(hit),
    };
  });

  const kbCovered =
    options.force !== true &&
    accepted.length > 0 &&
    accepted.every((hit) => hit.freshness.status === "fresh");

  return {
    kbCovered,
    since: newestStaleSourceDate(accepted),
    kbHits,
  };
}
