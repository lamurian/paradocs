/**
 * Atomicity validation for PARA knowledge documents.
 *
 * The primary atomicity gate is LLM decomposition at the command level:
 * each note must have one clear research question and one indicative answer.
 * The tool-level single-topic heuristic (keyword overlap between title and
 * heading sections) acts as a secondary safety net.
 *
 * Paragraph counts and heading counts are not enforced at the tool level.
 *
 * @module common/atomicity
 */

// ── Constants ─────────────────────────────────────────────────────────

const UNRELATED_SECTION_THRESHOLD = 2;

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
  "from",
  "as",
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
  "this",
  "that",
  "these",
  "those",
  "it",
  "its",
  "they",
  "them",
  "their",
  "we",
  "our",
  "you",
  "your",
  "he",
  "she",
  "his",
  "her",
  "not",
  "no",
  "nor",
  "so",
  "if",
  "then",
  "than",
  "too",
  "very",
  "just",
  "about",
  "also",
  "more",
  "some",
  "any",
  "each",
  "every",
  "all",
  "both",
  "few",
  "most",
  "other",
  "into",
  "over",
  "such",
  "only",
  "own",
  "same",
  "how",
  "what",
  "which",
  "who",
  "whom",
  "why",
  "when",
  "where",
]);

// ── Types ─────────────────────────────────────────────────────────────

export interface AtomicityResult {
  /** Whether the content passes all atomicity rules. */
  valid: boolean;
  /** The rule that failed (empty string if valid). */
  rule: string;
  /** The observed count that exceeded the limit (0 if valid). */
  count: number;
  /** The maximum allowed count (0 if valid). */
  limit: number;
  /** Descriptive error message with actionable guidance. */
  message: string;
}

// ── Helpers ─────────────────────────────────────────────────────────

/**
 * Strip fenced code blocks from content to avoid false positives
 * in keyword analysis.
 */
function stripFencedCodeBlocks(content: string): string {
  return content.replace(/```[\s\S]*?```/g, "");
}

/**
 * Extract significant words from text, excluding stop words
 * and short words (≤2 chars).
 */
function extractSignificantWords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP_WORDS.has(w));
}

/**
 * Validate that the content focuses on a single topic implied by the title.
 *
 * Heuristic approach — conservative (no false rejections):
 * - Extracts heading texts and compares keywords to the title.
 * - Only flags when there are {@link UNRELATED_SECTION_THRESHOLD}+ headings
 *   whose significant words share no overlap with the title.
 *
 * @returns `true` if the content appears to focus on a single coherent topic.
 */
function validateSingleTopic(content: string, title: string): boolean {
  const withoutCode = stripFencedCodeBlocks(content);
  const headingLines = withoutCode.match(/^#{2,3}\s+.+/gm);

  // Cannot assess coherence with fewer than 2 headings — pass
  if (!headingLines || headingLines.length < 2) return true;

  const titleWords = new Set(extractSignificantWords(title));
  // Cannot assess if title has no significant words — pass
  if (titleWords.size === 0) return true;

  let unrelatedSections = 0;

  for (const hl of headingLines) {
    const headingText = hl.replace(/^#{2,3}\s+/, "");
    const hWords = extractSignificantWords(headingText);
    if (hWords.length === 0) continue;

    // Check if any heading word overlaps with title words
    const hasOverlap = hWords.some((w) => titleWords.has(w));
    if (!hasOverlap) {
      unrelatedSections++;
    }
  }

  // Only flag at conservative threshold to avoid false rejections
  return unrelatedSections < UNRELATED_SECTION_THRESHOLD;
}

// ── Main export ─────────────────────────────────────────────────────

/**
 * Validate markdown content against the atomicity principle.
 *
 * The only tool-level check is the single-topic heuristic:
 * content heading sections must share keyword overlap with the title.
 * The primary atomicity gate is LLM decomposition at the command level
 * (one research question + one indicative answer per note).
 *
 * @param content - Markdown body content (without YAML frontmatter).
 * @param title   - Document title used for topic focus comparison.
 * @returns The first {@link AtomicityResult} violation or a valid result.
 */
export function validateAtomicity(content: string, title: string): AtomicityResult {
  // Single-topic heuristic (conservative safety net)
  if (!validateSingleTopic(content, title)) {
    return {
      valid: false,
      rule: "single-topic",
      count: 0,
      limit: 1,
      message:
        `Atomicity violation: single-topic. Content appears to cover multiple distinct topics ` +
        `unrelated to "${title}". Consider splitting into separate notes, one per topic.`,
    };
  }

  return { valid: true, rule: "", count: 0, limit: 0, message: "" };
}
