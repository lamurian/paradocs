/**
 * Deterministic evidence gathering for a list of research queries.
 *
 * The KB is consulted first; fresh, covered queries skip the web. Merged
 * web results are de-duplicated by canonical URL, ranked by trust class
 * and tier, then fetched with bounded concurrency. All side effects are
 * injected through {@link GatherEvidenceDeps}.
 *
 * @module common/gather-evidence
 */

import { evaluateKbCoverage } from "./gather-kb.ts";
import { classifyTrust } from "./trust.ts";
import { canonicalizeUrl } from "./url.ts";

import type { RelevanceConfig } from "./config-relevance.ts";
import type { EvidencePack, EvidencePackQuery, EvidenceSource } from "./evidence-cache.ts";
import type { GatherKbHit } from "./gather-kb.ts";
import type { SearchKind } from "./search-routing.ts";
import type { TrustClass } from "./trust.ts";
import type { SearchResult } from "../extensions/web-search/native.ts";

/** Maximum number of queries accepted in one gather call. */
export const MAX_QUERIES = 5;
/** Hard cap on sources fetched per gather call. */
export const MAX_SOURCES_CAP = 10;
/** Default number of sources fetched per gather call. */
export const DEFAULT_MAX_SOURCES = 5;

// Gather limits: fetch concurrency, timeout and excerpt size.
const FETCH_CONCURRENCY = 3;
const FETCH_TIMEOUT_MS = 20_000;
const EXCERPT_CHARS = 1500;
/** Trust ranking, most trustworthy first. */
const TRUST_ORDER: TrustClass[] = [
  "peer-reviewed",
  "gov-edu",
  "official-docs",
  "preprint",
  "reference",
  "unknown",
  "blog-forum",
];
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
}
/** A ranked web candidate plus the query that produced it. */
interface Candidate {
  result: SearchResult;
  query: string;
  order: number;
  canonical: string;
  trust: TrustClass;
}
/**
 * Rank of a trust class in the trust order; unknown values sort last.
 *
 * @param trust - Trust class to rank.
 * @returns Zero-based rank within the trust order.
 */
function trustRank(trust: TrustClass): number {
  const index = TRUST_ORDER.indexOf(trust);
  return index === -1 ? TRUST_ORDER.length : index;
}

/**
 * Collapse whitespace and truncate to the excerpt limit.
 *
 * @param content - Raw fetched content.
 * @returns Whitespace-collapsed content of at most 1500 characters.
 */
function toExcerpt(content: string): string {
  return content.replace(/\s+/g, " ").trim().slice(0, EXCERPT_CHARS);
}

/**
 * Dedupe web results by canonical URL, then rank by trust class, tier and
 * discovery order.
 *
 * @param candidates - Web results tagged with their originating query.
 * @returns Unique candidates in ranked order.
 */
function rankCandidates(candidates: Candidate[]): Candidate[] {
  const seen = new Set<string>();
  const unique = candidates.filter((candidate) => {
    if (seen.has(candidate.canonical)) return false;
    seen.add(candidate.canonical);
    return true;
  });

  return unique.sort((a, b) => {
    const byTrust = trustRank(a.trust) - trustRank(b.trust);
    if (byTrust !== 0) return byTrust;
    const tierA = a.result.tier ?? Number.MAX_SAFE_INTEGER;
    const tierB = b.result.tier ?? Number.MAX_SAFE_INTEGER;
    return tierA === tierB ? a.order - b.order : tierA - tierB;
  });
}

/**
 * Fetch candidates with bounded concurrency, recording failures per source.
 * Processing stops on abort; already-completed fetches are returned.
 *
 * @param sources - Sources to fetch, in ranked order.
 * @param deps - Injected fetch and clock dependencies.
 * @param signal - Optional cancellation signal.
 * @returns Fetched sources in the original ranked order.
 */
async function fetchSources(
  sources: EvidenceSource[],
  deps: GatherEvidenceDeps,
  signal?: AbortSignal,
): Promise<EvidenceSource[]> {
  const slots: (EvidenceSource | undefined)[] = Array.from(
    { length: sources.length },
    (): EvidenceSource | undefined => undefined,
  );
  let next = 0;

  const worker = async (): Promise<void> => {
    for (;;) {
      if (signal?.aborted) return;
      const index = next;
      next += 1;
      if (index >= sources.length) return;

      const source = sources[index];
      try {
        const fetched = await deps.fetch(source.url, FETCH_TIMEOUT_MS, signal);
        if (signal?.aborted) return;
        if ("error" in fetched) {
          slots[index] = { ...source, fetchError: fetched.error };
        } else {
          slots[index] = {
            ...source,
            title: fetched.title || source.title,
            excerpt: toExcerpt(fetched.content),
            content: fetched.content,
          };
        }
      } catch (error) {
        if (signal?.aborted) return;
        slots[index] = { ...source, fetchError: (error as Error).message };
      }
    }
  };

  const workers = Array.from({ length: Math.min(FETCH_CONCURRENCY, sources.length) }, () =>
    worker(),
  );
  await Promise.all(workers);

  return slots.filter((slot): slot is EvidenceSource => slot !== undefined);
}

/**
 * Gather a deterministic evidence pack for a question.
 *
 * The KB is searched for each query (top 5 hits). A query is `kbCovered`
 * when at least one hit passes the lexical relevance gate and every accepted
 * hit is fresh, unless `force` is set. Uncovered queries call the injected
 * web search with the newest source date of their accepted non-fresh hits as
 * `since`. Web results are merged, deduplicated by
 * canonical URL and ranked by trust class, then tier, then discovery
 * order. The top `maxSources` are fetched with concurrency 3 and a 20 s
 * timeout; a failure records `fetchError` on that source without aborting
 * the run.
 *
 * @param input - Question, queries (1-5), optional source cap and force flag.
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

  const packQueries: EvidencePackQuery[] = [];
  const candidates: Candidate[] = [];
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

  const ranked = rankCandidates(candidates).slice(0, maxSources);
  const sources = await fetchSources(
    ranked.map((candidate) => ({
      url: candidate.result.url,
      canonicalUrl: candidate.canonical,
      title: candidate.result.title,
      trust: candidate.trust,
      tier: candidate.result.tier ?? null,
      query: candidate.query,
      excerpt: "",
    })),
    deps,
    signal,
  );

  return {
    question: input.question,
    createdAt: deps.now().toISOString(),
    queries: packQueries,
    sources,
  };
}
