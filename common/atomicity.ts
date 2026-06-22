/**
 * Atomicity validation for PARA knowledge documents.
 *
 * Enforces the atomic principle: one key idea per document,
 * max 4 paragraphs, max 2 heading sections (## or ###).
 *
 * @module common/atomicity
 */

// ── Constants ─────────────────────────────────────────────────────────

const MAX_PARAGRAPHS = 4;
const MAX_HEADINGS = 2;
const UNRELATED_SECTION_THRESHOLD = 3;

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
 * when counting paragraphs and headings.
 */
function stripFencedCodeBlocks(content: string): string {
  return content.replace(/```[\s\S]*?```/g, "");
}

/**
 * Count paragraph blocks in content.
 *
 * Blocks are separated by one or more blank lines.
 * Fenced code blocks are normalised to a single placeholder so that
 * internal blank lines don't inflate the count.
 * Each code block, list, or blockquote counts as one paragraph block.
 */
function countParagraphBlocks(content: string): number {
  const trimmed = content.trim();
  if (!trimmed) return 0;

  // Normalise fenced code blocks to avoid blank lines inside fences
  // being counted as paragraph separators
  const normalized = trimmed.replace(/```[\s\S]*?```/g, "CODE_BLOCK");

  // Split by two or more consecutive newlines (blank line separator)
  const blocks = normalized.split(/\n{2,}/).filter((b) => b.trim().length > 0);
  return blocks.length;
}

/**
 * Count ## (H2) and ### (H3) headings.
 *
 * #### and below are not counted as heading sections.
 * Headings inside fenced code blocks are ignored.
 */
function countRelevantHeadings(content: string): number {
  const withoutCode = stripFencedCodeBlocks(content);
  const matches = withoutCode.match(/^#{2,3}\s+.+/gm);
  return matches ? matches.length : 0;
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
 * Three rules checked in order (most objective first):
 * 1. **Heading limit** (## or ###) — max {@link MAX_HEADINGS}.
 * 2. **Paragraph limit** — max {@link MAX_PARAGRAPHS}.
 * 3. **Single topic** — content addresses one coherent topic.
 *
 * Returns the **first** violation found. If all rules pass, returns
 * `{ valid: true }` with empty rule/message fields.
 *
 * @param content - Markdown body content (without YAML frontmatter).
 * @param title   - Document title used for topic focus comparison.
 * @returns The first {@link AtomicityResult} violation or a valid result.
 */
export function validateAtomicity(content: string, title: string): AtomicityResult {
  // Rule 3: Heading limit (most objective — check first)
  const headingCount = countRelevantHeadings(content);
  if (headingCount > MAX_HEADINGS) {
    return {
      valid: false,
      rule: "heading-limit",
      count: headingCount,
      limit: MAX_HEADINGS,
      message:
        `Atomicity violation: heading-limit. Found ${headingCount}, max ${MAX_HEADINGS}. ` +
        `Condense into fewer sections or split into separate notes.`,
    };
  }

  // Rule 2: Paragraph limit
  const paraCount = countParagraphBlocks(content);
  if (paraCount > MAX_PARAGRAPHS) {
    return {
      valid: false,
      rule: "paragraph-limit",
      count: paraCount,
      limit: MAX_PARAGRAPHS,
      message:
        `Atomicity violation: paragraph-limit. Found ${paraCount}, max ${MAX_PARAGRAPHS}. ` +
        `Condense the content or split into multiple notes.`,
    };
  }

  // Rule 1: Single topic (most heuristic — check last, conservatively)
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
