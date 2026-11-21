/**
 * Deterministic quote verification against a source text.
 *
 * Both inputs are normalized (NFKC, lowercase, straight quotes, plain
 * hyphens, markdown emphasis stripped, whitespace collapsed). An exact
 * substring wins; otherwise a sliding window of the same token count is
 * scored with a multiset Dice coefficient and the best window is reported
 * when it reaches the threshold.
 *
 * @module common/verify-quote
 */

/** Outcome of a quote verification. */
export type VerifyQuoteMatch = "exact" | "fuzzy" | "not-found";

/** Result returned by {@link verifyQuote}. */
export interface VerifyQuoteResult {
  match: VerifyQuoteMatch;
  score: number;
  excerpt: string | null;
}

/** Options for {@link verifyQuote}. */
export interface VerifyQuoteOptions {
  threshold?: number;
}

/** Default fuzzy-match threshold. */
const DEFAULT_THRESHOLD = 0.85;

/**
 * Normalize text for comparison.
 *
 * Applies NFKC, lowercases, maps curly quotes to straight quotes and dash
 * variants to '-', strips markdown `*` and `_`, then collapses whitespace.
 *
 * @param text - Raw text to normalize.
 * @returns Normalized text.
 */
function normalize(text: string): string {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\u2018\u2019\u201A\u201B\u2032]/g, "'")
    .replace(/[\u201C\u201D\u201E\u201F\u2033]/g, '"')
    .replace(/[\u2010-\u2015\u2212]/g, "-")
    .replace(/[*_]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Split normalized text into whitespace-delimited tokens.
 *
 * @param text - Normalized text.
 * @returns Token list; empty for blank input.
 */
function tokensOf(text: string): string[] {
  return text.length === 0 ? [] : text.split(" ");
}

/**
 * Count how many tokens in a window also occur in the quote multiset.
 *
 * @param quoteCounts - Token counts for the quote.
 * @param window - Candidate source window.
 * @returns Size of the multiset intersection.
 */
function overlapCount(quoteCounts: Map<string, number>, window: string[]): number {
  const remaining = new Map(quoteCounts);
  let overlap = 0;
  for (const token of window) {
    const available = remaining.get(token) ?? 0;
    if (available > 0) {
      remaining.set(token, available - 1);
      overlap += 1;
    }
  }
  return overlap;
}

/**
 * Verify a quote against a source text.
 *
 * @param quote - Quote to look for.
 * @param text - Source text to search.
 * @param opts - Optional fuzzy threshold (default 0.85).
 * @returns Match kind, score in [0, 1], and the matching excerpt (if any).
 */
export function verifyQuote(
  quote: string,
  text: string,
  opts: VerifyQuoteOptions = {},
): VerifyQuoteResult {
  const threshold = opts.threshold ?? DEFAULT_THRESHOLD;
  const normalizedQuote = normalize(quote);
  const normalizedText = normalize(text);

  if (normalizedQuote.length > 0) {
    const index = normalizedText.indexOf(normalizedQuote);
    if (index >= 0) {
      return {
        match: "exact",
        score: 1,
        excerpt: normalizedText.slice(index, index + normalizedQuote.length),
      };
    }
  }

  const quoteTokens = tokensOf(normalizedQuote);
  const sourceTokens = tokensOf(normalizedText);
  const windowSize = quoteTokens.length;

  if (windowSize === 0 || sourceTokens.length < windowSize) {
    return { match: "not-found", score: 0, excerpt: null };
  }

  const quoteCounts = new Map<string, number>();
  for (const token of quoteTokens) {
    quoteCounts.set(token, (quoteCounts.get(token) ?? 0) + 1);
  }

  let bestScore = 0;
  let bestWindow: string[] | null = null;

  for (let start = 0; start <= sourceTokens.length - windowSize; start += 1) {
    const window = sourceTokens.slice(start, start + windowSize);
    const overlap = overlapCount(quoteCounts, window);
    const score = (2 * overlap) / (windowSize + window.length);
    if (score > bestScore) {
      bestScore = score;
      bestWindow = window;
    }
  }

  if (bestWindow !== null && bestScore >= threshold) {
    return { match: "fuzzy", score: bestScore, excerpt: bestWindow.join(" ") };
  }

  return { match: "not-found", score: bestScore, excerpt: null };
}
