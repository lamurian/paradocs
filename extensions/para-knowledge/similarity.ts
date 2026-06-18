/**
 * Text similarity helpers for findExistingSummary.
 * Jaccard similarity on word trigrams for content dedup.
 */

/**
 * Build a set of word trigrams from text.
 * "the quick brown fox" -> {"the quick brown", "quick brown fox"}
 */
export function wordTrigrams(text: string): Set<string> {
  const words = text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 0);

  const trigrams = new Set<string>();
  for (let i = 0; i <= words.length - 3; i++) {
    trigrams.add(`${words[i]} ${words[i + 1]} ${words[i + 2]}`);
  }
  return trigrams;
}

/**
 * Compute Jaccard similarity between two sets.
 * |A ∩ B| / |A ∪ B|
 */
export function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  const intersection = new Set<string>();
  for (const item of a) {
    if (b.has(item)) intersection.add(item);
  }
  const union = new Set<string>([...a, ...b]);
  if (union.size === 0) return 0;
  return intersection.size / union.size;
}

/**
 * Compute Jaccard similarity between two text strings using word trigrams.
 */
export function textSimilarity(textA: string, textB: string): number {
  return jaccardSimilarity(wordTrigrams(textA), wordTrigrams(textB));
}
