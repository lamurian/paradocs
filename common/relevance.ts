/**
 * Deterministic lexical coverage scoring for relevance gating.
 *
 * A document is split into a strong field (title, description, tags, path,
 * URL host and path) and an optional body. Query terms are stemmed and matched
 * as whole tokens only; coverage is the IDF-weighted fraction of query terms
 * that appear in either field. The lexical scorer adds an anchor rule so a
 * document cannot pass by matching only common terms.
 *
 * The pluggable {@link RelevanceScorer} interface lets a semantic scorer be
 * added later without changing callers.
 *
 * @module common/relevance
 */

import { tokenize } from "./tokenize.ts";

/** Document fields available to a relevance scorer. */
export interface RelevanceDoc {
  strong: string[];
  body?: string;
}

/** Result of evaluating one document against one query. */
export interface RelevanceVerdict {
  score: number;
  pass: boolean;
}

/** Pluggable relevance scorer. */
export interface RelevanceScorer {
  name: string;
  evaluate(query: string, doc: RelevanceDoc): RelevanceVerdict;
}

/** Options for {@link createLexicalScorer}. */
export interface LexicalScorerOptions {
  threshold: number;
  bodyWeight?: number;
  idf?: (term: string) => number;
  requireAnchor?: boolean;
}

/** Options accepted by {@link coverageScore}. */
export interface CoverageOptions {
  bodyWeight?: number;
  idf?: (term: string) => number;
}

/** Internal coverage result including the anchor decision. */
interface CoverageResult {
  score: number;
  anchorMatched: boolean;
}

/** Default credit given to a query term found only in the body. */
const DEFAULT_BODY_WEIGHT = 0.5;

/** Vowel-less suffixes stripped in the stemmer's final steps. */
const VOWEL_SUFFIXES = ["ing", "ed"];

/**
 * Stem a single lowercase token with a small, deterministic rule set.
 *
 * @param token Lowercase alphanumeric token.
 * @returns The stemmed token.
 */
function stem(token: string): string {
  let out = token;

  if (out.endsWith("ies") && out.length > 4) {
    out = `${out.slice(0, -3)}y`;
  } else if (out.endsWith("es") && /(?:ch|sh|x|z|ss)es$/.test(out)) {
    out = out.slice(0, -2);
  } else if (out.endsWith("s") && !out.endsWith("ss") && out.length > 3) {
    out = out.slice(0, -1);
  }

  for (const suffix of VOWEL_SUFFIXES) {
    if (out.endsWith(suffix) && out.length - suffix.length >= 4) {
      out = out.slice(0, -suffix.length);
      break;
    }
  }

  if (out.endsWith("e") && out.length > 3) {
    out = out.slice(0, -1);
  }

  return out;
}

/**
 * Split text into lowercase, stop-word-filtered, stemmed tokens.
 *
 * Reuses {@link tokenize} for the split and stop-word step so relevance
 * matching stays consistent with the rest of the codebase.
 *
 * @param text Any text field.
 * @returns Stemmed tokens in source order.
 */
export function relevanceTokens(text: string): string[] {
  return tokenize(text).map(stem);
}

/**
 * Build the set of stems present in a document's strong fields.
 *
 * @param doc Document under evaluation.
 * @returns Stemmed strong-field tokens.
 */
function strongStems(doc: RelevanceDoc): Set<string> {
  return new Set(relevanceTokens(doc.strong.join(" ")));
}

/**
 * Build the set of stems present in a document's body.
 *
 * @param doc Document under evaluation.
 * @returns Stemmed body tokens.
 */
function bodyStems(doc: RelevanceDoc): Set<string> {
  return new Set(relevanceTokens(doc.body ?? ""));
}

/**
 * Compute coverage and anchor status for one query/document pair.
 *
 * @param query Raw query string.
 * @param doc Document under evaluation.
 * @param opts Optional body weight and IDF function.
 * @returns Coverage score and whether an anchor matched in a strong field.
 */
function computeCoverage(
  query: string,
  doc: RelevanceDoc,
  opts: CoverageOptions = {},
): CoverageResult {
  const bodyWeight = opts.bodyWeight ?? DEFAULT_BODY_WEIGHT;
  const idf = opts.idf ?? (() => 1);
  const rawTerms = tokenize(query);

  const byStem = new Map<string, string>();
  for (const raw of rawTerms) {
    const stemmed = stem(raw);
    if (!byStem.has(stemmed)) byStem.set(stemmed, raw);
  }

  if (byStem.size === 0) {
    return { score: 0, anchorMatched: false };
  }

  const strong = strongStems(doc);
  const body = bodyStems(doc);

  let weightSum = 0;
  let creditSum = 0;
  let maxWeight = -Infinity;
  const anchors: string[] = [];

  for (const [stemmed, raw] of byStem) {
    const weight = idf(raw);
    weightSum += weight;

    const credit = strong.has(stemmed) ? 1 : body.has(stemmed) ? bodyWeight : 0;
    creditSum += weight * credit;

    if (weight > maxWeight) {
      maxWeight = weight;
      anchors.length = 0;
      anchors.push(stemmed);
    } else if (weight === maxWeight) {
      anchors.push(stemmed);
    }
  }

  const score = weightSum === 0 ? 0 : creditSum / weightSum;
  const anchorMatched = anchors.some((stemmed) => strong.has(stemmed));

  return { score, anchorMatched };
}

/**
 * Compute the IDF-weighted lexical coverage of a query against a document.
 *
 * @param query Raw query string.
 * @param doc Document under evaluation.
 * @param opts Optional body weight (default 0.5) and IDF function (default 1).
 * @returns Coverage score in the range 0..1.
 */
export function coverageScore(query: string, doc: RelevanceDoc, opts?: CoverageOptions): number {
  return computeCoverage(query, doc, opts).score;
}

/**
 * Create a lexical relevance scorer that gates on coverage and an anchor rule.
 *
 * The anchor rule requires at least one highest-IDF query term to appear in a
 * strong field, preventing a pass driven solely by common body terms.
 *
 * @param opts Threshold plus optional body weight, IDF function and anchor flag.
 * @returns A scorer named `lexical`.
 */
export function createLexicalScorer(opts: LexicalScorerOptions): RelevanceScorer {
  const bodyWeight = opts.bodyWeight ?? DEFAULT_BODY_WEIGHT;
  const idf = opts.idf ?? (() => 1);
  const requireAnchor = opts.requireAnchor ?? true;

  return {
    name: "lexical",
    evaluate(query: string, doc: RelevanceDoc): RelevanceVerdict {
      const { score, anchorMatched } = computeCoverage(query, doc, {
        bodyWeight,
        idf,
      });
      const pass = score >= opts.threshold && (!requireAnchor || anchorMatched);
      return { score, pass };
    },
  };
}
