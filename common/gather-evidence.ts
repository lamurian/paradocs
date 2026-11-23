/**
 * Deterministic evidence gathering for a list of research queries.
 *
 * The KB is consulted first; fresh, covered queries skip the web. Merged
 * web results are de-duplicated by canonical URL, ranked by lexical
 * relevance, then fetched with bounded concurrency. All side effects are
 * injected through {@link GatherEvidenceDeps}.
 *
 * @module common/gather-evidence
 */

import { evaluateKbCoverage } from "./gather-kb.ts";
import { fetchPrimarySources, fetchRankedSources, rankCandidates } from "./gather-sources.ts";
import { classifyTrust } from "./trust.ts";
import { canonicalizeUrl } from "./url.ts";

import type { RelevanceConfig } from "./config-relevance.ts";
import type { EvidencePack, EvidencePackQuery } from "./evidence-cache.ts";
import type { GatherKbHit } from "./gather-kb.ts";
import type { WebCandidate } from "./gather-sources.ts";
import type { SearchKind } from "./search-routing.ts";
import type { SearchResult } from "../extensions/web-search/native.ts";

/** Maximum number of queries accepted in one gather call. */
export const MAX_QUERIES = 5;
/** Hard cap on sources fetched per gather call. */
export const MAX_SOURCES_CAP = 10;
/** Default number of sources fetched per gather call. */
export const DEFAULT_MAX_SOURCES = 5;

export type { GatherKbHit } from "./gather-kb.ts";
/** Injected dependencies, kept explicit for deterministic testing. */
export interface GatherEvidenceDeps {
  searchKb: (query: string) => GatherKbHit[];
  searchWeb: (
    query: string,
    opts: { since: string | null; kind: SearchKind },
  ) => Promise<SearchResult[]>;
  fetch: (
    url: string,
    timeoutMs: number,
    signal?: AbortSignal,
  ) => Promise<{ title: string; content: string } | { error: string }>;
  now: () => Date;
  idf?: (term: string) => number;
  relevance?: RelevanceConfig;
}
/** Input accepted by {@link gatherEvidence}. */
export interface GatherEvidenceInput {
  question: string;
  queries: string[];
  maxSources?: number;
  force?: boolean;
  kind?: SearchKind;
  urls?: string[];
}

/**
 * Gather a deterministic evidence pack for a question.
 *
 * The KB is searched for each query (top 5 hits). A query is `kbCovered`
 * when at least one hit passes the lexical relevance gate and every accepted
 * hit is fresh, unless `force` is set. Uncovered queries call the injected
 * web search with the newest source date of their accepted non-fresh hits as
 * `since`. Web results are merged, deduplicated by canonical URL and ranked
 * by lexical relevance; candidates below the prefetch threshold are never
 * fetched. Ranked candidates are fetched with concurrency 3 and a 20 s
 * timeout until `maxSources` sources pass the junk check and output relevance
 * gate. Primary URLs are fetched directly and placed first, bypassing the
 * prefetch and output relevance gates and not counting toward `maxSources`.
 * Rejected pages are recorded in `rejected` with their reason.
 *
 * @param input - Question, queries (1-5), optional source cap, force flag and
 * primary URLs.
 * @param deps - Injected KB search, web search, fetch and clock.
 * @param signal - Optional cancellation signal; stops further fetches.
 * @returns The evidence pack contents, without an id.
 * @throws Error when no queries or more than five queries are supplied.
 */
export async function gatherEvidence(
  input: GatherEvidenceInput,
  deps: GatherEvidenceDeps,
  signal?: AbortSignal,
): Promise<Omit<EvidencePack, "id">> {
  const queries = input.queries.map((query) => query.trim()).filter((query) => query.length > 0);
  if (queries.length < 1 || queries.length > MAX_QUERIES) {
    throw new Error(`gatherEvidence expects 1-${MAX_QUERIES} queries, received ${queries.length}`);
  }

  const requested =
    input.maxSources === undefined ? DEFAULT_MAX_SOURCES : Math.floor(input.maxSources);
  const maxSources = Math.min(Math.max(requested, 0), MAX_SOURCES_CAP);

  const primary = await fetchPrimarySources(input.urls ?? [], { fetch: deps.fetch }, signal);

  const packQueries: EvidencePackQuery[] = [];
  const candidates: WebCandidate[] = [];
  let order = 0;

  for (const query of queries) {
    const coverage = evaluateKbCoverage(query, deps.searchKb(query), {
      force: input.force === true,
      idf: deps.idf,
      relevance: deps.relevance,
    });
    const { kbCovered, since, kbHits } = coverage;

    packQueries.push({ query, kbCovered, since, kbHits });
    if (kbCovered) continue;

    const results = await deps.searchWeb(query, { since, kind: input.kind ?? "general" });
    for (const result of results) {
      candidates.push({
        result,
        query,
        order,
        canonical: canonicalizeUrl(result.url),
        trust: classifyTrust(result.url),
      });
      order += 1;
    }
  }

  const ranked = rankCandidates(candidates, {
    idf: deps.idf,
    relevance: deps.relevance,
  });
  const fetched = await fetchRankedSources(
    ranked,
    {
      maxSources,
      idf: deps.idf,
      relevance: deps.relevance,
      fetch: deps.fetch,
    },
    signal,
  );

  return {
    question: input.question,
    createdAt: deps.now().toISOString(),
    queries: packQueries,
    sources: [...primary.sources, ...fetched.sources],
    rejected: [...primary.rejected, ...fetched.rejected],
  };
}
