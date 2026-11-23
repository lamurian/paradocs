/**
 * Web candidate ranking and source fetching for evidence gathering.
 *
 * Candidates are scored and filtered by the prefetch threshold, then fetched;
 * pages must pass the junk check and output relevance gate to be accepted.
 *
 * @module common/gather-sources
 */

import { DEFAULT_RELEVANCE_CONFIG } from "./config-relevance.ts";
import { detectJunkPage } from "./fetch-quality.ts";
import { coverageScore, createLexicalScorer } from "./relevance.ts";

import type { RelevanceConfig } from "./config-relevance.ts";
import type { EvidenceSource } from "./evidence-cache.ts";
import type { TrustClass } from "./trust.ts";
import type { SearchResult } from "../extensions/web-search/native.ts";

/** Fetch concurrency, timeout, excerpt size, minimum page size and attempt cap. */
const FETCH_CONCURRENCY = 3;
const FETCH_TIMEOUT_MS = 20_000;
const EXCERPT_CHARS = 1500;
const MIN_PAGE_CHARS = 300;
const ATTEMPTS_PER_SOURCE = 3;

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

/** A web search result tagged with the query that produced it. */
export interface WebCandidate {
  result: SearchResult;
  query: string;
  order: number;
  canonical: string;
  trust: TrustClass;
}

/** A fetched candidate that was not accepted as a source. */
export interface RejectedSource {
  url: string;
  reason: string;
}
/** Ranking options for {@link rankCandidates}. */
export interface RankOptions {
  idf?: (term: string) => number;
  relevance?: RelevanceConfig;
}
/** Fetch options for {@link fetchRankedSources}. */
export interface FetchSourcesOptions {
  maxSources: number;
  idf?: (term: string) => number;
  relevance?: RelevanceConfig;
  fetch: (
    url: string,
    timeoutMs: number,
    signal?: AbortSignal,
  ) => Promise<{ title: string; content: string } | { error: string }>;
}
/** Accepted sources plus rejected candidates from one fetch pass. */
export interface FetchSourcesResult {
  sources: EvidenceSource[];
  rejected: RejectedSource[];
}
/** One fetch outcome, keeping its candidate and rejection reason. */
interface FetchOutcome {
  candidate: WebCandidate;
  fetched?: { title: string; content: string };
  error?: string;
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
 * Collapse whitespace and truncate content to the excerpt limit.
 *
 * @param content - Raw fetched content.
 * @returns Whitespace-collapsed excerpt of at most 1500 characters.
 */
function toExcerpt(content: string): string {
  return content.slice(0, EXCERPT_CHARS).replace(/\s+/g, " ").trim();
}

/**
 * Build the strong URL field: host plus pathname.
 *
 * @param url - Source URL.
 * @returns `host/path` when parseable, otherwise the trimmed URL.
 */
function urlStrong(url: string): string {
  try {
    const parsed = new URL(url.trim());
    return `${parsed.hostname}${parsed.pathname}`;
  } catch {
    return url.trim();
  }
}

/**
 * Rank web candidates by lexical relevance, keeping only candidates at or
 * above the prefetch threshold.
 *
 * Candidates are de-duplicated by canonical URL first (the earliest discovery
 * wins). Ties are broken by trust class, then tier, then discovery order.
 *
 * @param candidates - Web results tagged with their originating query.
 * @param opts - Optional IDF function and relevance config.
 * @returns Unique relevant candidates in ranked order.
 */
export function rankCandidates(candidates: WebCandidate[], opts: RankOptions = {}): WebCandidate[] {
  const relevance = opts.relevance ?? DEFAULT_RELEVANCE_CONFIG;
  const seen = new Set<string>();
  const unique = candidates.filter((candidate) => {
    if (seen.has(candidate.canonical)) return false;
    seen.add(candidate.canonical);
    return true;
  });

  const scored = unique
    .map((candidate) => ({
      candidate,
      score: coverageScore(
        candidate.query,
        {
          strong: [
            candidate.result.title,
            candidate.result.snippet,
            urlStrong(candidate.result.url),
          ],
        },
        { idf: opts.idf, bodyWeight: relevance.bodyWeight },
      ),
    }))
    .filter((entry) => entry.score >= relevance.prefetchThreshold);

  scored.sort((a, b) => {
    const byScore = b.score - a.score;
    if (byScore !== 0) return byScore;
    const byTrust = trustRank(a.candidate.trust) - trustRank(b.candidate.trust);
    if (byTrust !== 0) return byTrust;
    const tierA = a.candidate.result.tier ?? Number.MAX_SAFE_INTEGER;
    const tierB = b.candidate.result.tier ?? Number.MAX_SAFE_INTEGER;
    if (tierA !== tierB) return tierA - tierB;
    return a.candidate.order - b.candidate.order;
  });

  return scored.map((entry) => entry.candidate);
}

/**
 * Fetch one candidate, converting thrown errors into an error outcome.
 *
 * @param candidate - Candidate to fetch.
 * @param opts - Fetch function plus output-gate settings.
 * @param signal - Optional cancellation signal.
 * @returns The fetch outcome for one candidate.
 */
async function fetchCandidate(
  candidate: WebCandidate,
  opts: FetchSourcesOptions,
  signal?: AbortSignal,
): Promise<FetchOutcome> {
  try {
    const fetched = await opts.fetch(candidate.result.url, FETCH_TIMEOUT_MS, signal);
    if ("error" in fetched) return { candidate, error: fetched.error };
    return { candidate, fetched };
  } catch (error) {
    return { candidate, error: (error as Error).message };
  }
}

/**
 * Decide whether a fetch outcome is an acceptable source.
 *
 * @param outcome - Completed fetch outcome.
 * @param opts - Output-gate settings.
 * @returns Either a rejected reason or the accepted source.
 */
function evaluateOutcome(
  outcome: FetchOutcome,
  opts: FetchSourcesOptions,
): { rejected: RejectedSource } | { source: EvidenceSource } {
  const { candidate } = outcome;
  if (outcome.error !== undefined) {
    return { rejected: { url: candidate.result.url, reason: outcome.error } };
  }

  const fetched = outcome.fetched;
  if (fetched === undefined) {
    return { rejected: { url: candidate.result.url, reason: "fetch returned no content" } };
  }

  const title = fetched.title || candidate.result.title;
  const junk = detectJunkPage(title, fetched.content, { minChars: MIN_PAGE_CHARS });
  if (junk !== null) {
    return { rejected: { url: candidate.result.url, reason: junk } };
  }

  const relevance = opts.relevance ?? DEFAULT_RELEVANCE_CONFIG;
  const scorer = createLexicalScorer({
    threshold: relevance.outputThreshold,
    bodyWeight: relevance.bodyWeight,
    idf: opts.idf,
  });
  const excerpt = toExcerpt(fetched.content);
  const verdict = scorer.evaluate(candidate.query, {
    strong: [title, urlStrong(candidate.result.url), excerpt],
    body: fetched.content.slice(EXCERPT_CHARS),
  });

  if (!verdict.pass) {
    return {
      rejected: {
        url: candidate.result.url,
        reason: `low-relevance ${verdict.score.toFixed(2)}`,
      },
    };
  }

  return {
    source: {
      url: candidate.result.url,
      canonicalUrl: candidate.canonical,
      title,
      trust: candidate.trust,
      tier: candidate.result.tier ?? null,
      query: candidate.query,
      excerpt,
      content: fetched.content,
      relevance: verdict.score,
    },
  };
}

/**
 * Fetch ranked candidates with concurrency 3 until enough sources are accepted.
 *
 * At most `3 x maxSources` fetch attempts are made. Accepted sources keep the
 * ranked order; every failed, junk or low-relevance page is recorded in
 * `rejected` with its reason.
 *
 * @param ranked - Candidates in ranked order.
 * @param opts - Fetch function, source cap and output-gate settings.
 * @param signal - Optional cancellation signal; stops further fetches.
 * @returns Accepted sources in ranked order plus rejected candidates.
 */
export async function fetchRankedSources(
  ranked: WebCandidate[],
  opts: FetchSourcesOptions,
  signal?: AbortSignal,
): Promise<FetchSourcesResult> {
  const maxSources = Math.max(0, opts.maxSources);
  const attemptLimit = maxSources * ATTEMPTS_PER_SOURCE;
  const sources: EvidenceSource[] = [];
  const rejected: RejectedSource[] = [];
  let cursor = 0;
  let attempts = 0;

  while (sources.length < maxSources && cursor < ranked.length && attempts < attemptLimit) {
    if (signal?.aborted) break;

    const batchSize = Math.min(FETCH_CONCURRENCY, ranked.length - cursor, attemptLimit - attempts);
    const batch = ranked.slice(cursor, cursor + batchSize);
    cursor += batch.length;
    attempts += batch.length;

    const outcomes = await Promise.all(
      batch.map((candidate) => fetchCandidate(candidate, opts, signal)),
    );
    if (signal?.aborted) break;

    for (const outcome of outcomes) {
      if (sources.length >= maxSources) break;
      const verdict = evaluateOutcome(outcome, opts);
      if ("source" in verdict) sources.push(verdict.source);
      else rejected.push(verdict.rejected);
    }
  }

  return { sources, rejected };
}
