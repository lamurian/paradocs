/**
 * Relevance gate that composes multiple {@link RelevanceScorer} instances.
 *
 * An item is accepted only when every registered scorer passes it (logical
 * AND). This is the extension point for a future semantic scorer: adding one
 * vetoes items the lexical scorer would otherwise accept.
 *
 * Accepted items are sorted by the first scorer's score descending (stable for
 * ties), cut so only scores >= relativeCut x best survive, then capped at
 * maxHits. Rejected items keep their input order.
 *
 * @module common/relevance-gate
 */

import type { RelevanceDoc, RelevanceScorer } from "./relevance.ts";

/** One item with its gate verdict. */
export interface ScoredItem<T> {
  item: T;
  score: number;
  scores: Record<string, number>;
  pass: boolean;
}

/** Gate configuration. */
export interface GateOptions {
  scorers: RelevanceScorer[];
  relativeCut: number;
  maxHits: number;
}

/** Accepted and rejected partitions produced by {@link gateByRelevance}. */
export interface GateResult<T> {
  accepted: ScoredItem<T>[];
  rejected: ScoredItem<T>[];
}

/**
 * Evaluate one item against every scorer.
 *
 * @param query Raw query string.
 * @param item Item under evaluation.
 * @param toDoc Maps an item to a relevance document.
 * @param scorers Scorers to run.
 * @returns Scored item with an AND-composed pass flag.
 */
function scoreItem<T>(
  query: string,
  item: T,
  toDoc: (item: T) => RelevanceDoc,
  scorers: RelevanceScorer[],
): ScoredItem<T> {
  const doc = toDoc(item);
  const scores: Record<string, number> = {};
  let pass = true;
  let first = 0;

  for (let index = 0; index < scorers.length; index++) {
    const scorer = scorers[index];
    if (scorer === undefined) continue;
    const verdict = scorer.evaluate(query, doc);
    scores[scorer.name] = verdict.score;
    if (index === 0) first = verdict.score;
    if (!verdict.pass) pass = false;
  }

  return { item, score: first, scores, pass };
}

/**
 * Sort passing items by score descending, keeping input order for ties.
 *
 * @param items Passing scored items in input order.
 * @returns A new array sorted by score descending.
 */
function sortByScore<T>(items: ScoredItem<T>[]): ScoredItem<T>[] {
  return items
    .map((entry, index) => ({ entry, index }))
    .sort((a, b) => b.entry.score - a.entry.score || a.index - b.index)
    .map(({ entry }) => entry);
}

/**
 * Gate items by composed relevance: all scorers must pass, then apply the
 * relative cut and the hard cap.
 *
 * @param query Raw query string.
 * @param items Candidate items.
 * @param toDoc Maps an item to a relevance document.
 * @param opts Scorers plus relative cut and hard cap.
 * @returns Accepted items in ranked order and rejected items in input order.
 */
export function gateByRelevance<T>(
  query: string,
  items: T[],
  toDoc: (item: T) => RelevanceDoc,
  opts: GateOptions,
): GateResult<T> {
  const scored = items.map((item) => scoreItem(query, item, toDoc, opts.scorers));
  const passing = sortByScore(scored.filter((entry) => entry.pass));

  const accepted: ScoredItem<T>[] = [];
  const best = passing[0]?.score ?? 0;
  const cut = Math.max(0, opts.relativeCut) * best;

  for (const entry of passing) {
    if (accepted.length >= opts.maxHits) break;
    if (entry.score >= cut) accepted.push(entry);
  }

  const acceptedSet = new Set(accepted);
  const rejected = scored.filter((entry) => !acceptedSet.has(entry));

  return { accepted, rejected };
}
