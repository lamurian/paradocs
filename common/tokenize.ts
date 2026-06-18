/**
 * Shared tokenizer and BM25 scoring for PARA document search.
 *
 * Used by para-knowledge (search.ts, sync.ts), batch-create (yaml.ts),
 * roadmap-scratchpad (utils.ts), and findExistingSummary.ts
 */

// ── Stop words ──────────────────────────────────────────────────

const STOP_WORDS = new Set([
  "a",
  "an",
  "the",
  "and",
  "or",
  "but",
  "in",
  "on",
  "at",
  "to",
  "for",
  "of",
  "with",
  "by",
  "is",
  "are",
  "was",
  "were",
  "be",
  "been",
  "being",
  "have",
  "has",
  "had",
  "do",
  "does",
  "did",
  "will",
  "would",
  "could",
  "should",
  "may",
  "might",
  "shall",
  "can",
  "need",
  "dare",
  "ought",
  "used",
  "about",
  "above",
  "after",
  "again",
  "all",
  "also",
  "any",
  "because",
  "before",
  "between",
  "both",
  "each",
  "few",
  "from",
  "here",
  "how",
  "into",
  "just",
  "more",
  "most",
  "no",
  "not",
  "now",
  "only",
  "other",
  "over",
  "per",
  "same",
  "such",
  "than",
  "that",
  "their",
  "them",
  "there",
  "these",
  "they",
  "this",
  "those",
  "through",
  "under",
  "until",
  "very",
  "what",
  "when",
  "where",
  "which",
  "while",
  "who",
  "why",
  "up",
  "down",
  "out",
  "off",
  "about",
  "above",
]);

/**
 * Tokenise text into lowercase alphanumeric words,
 * removing stop words and single-character tokens.
 */
export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1 && !STOP_WORDS.has(t));
}

/**
 * Compute the Okapi BM25 term contribution.
 *
 * @param tf         Term frequency in the document
 * @param df         Document frequency (number of docs containing this term)
 * @param N          Total number of documents in the corpus
 * @param docLength  Length of this document (in tokens)
 * @param avgDocLen  Average document length across the corpus
 * @param k1         BM25 k1 parameter (term frequency saturation)
 * @param b          BM25 b parameter (length normalisation)
 */
export function bm25TermScore(
  tf: number,
  df: number,
  N: number,
  docLength: number,
  avgDocLen: number,
  k1: number = 1.2,
  b: number = 0.75,
): number {
  if (df <= 0 || N <= 0) return 0;
  const idf = Math.log((N - df + 0.5) / (df + 0.5) + 1);
  const numerator = tf * (k1 + 1);
  const denominator = tf + k1 * (1 - b + b * (docLength / Math.max(avgDocLen, 1)));
  return idf * (numerator / denominator);
}
