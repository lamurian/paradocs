/**
 * Pandoc citation-key extraction.
 *
 * Finds `@key` citations in markdown text. A citekey must be introduced by a
 * valid Pandoc prefix (line start, whitespace, `[`, `;` or `(`), which also
 * prevents email addresses such as `a@b.com` from matching.
 */

/** A citekey: a leading alphanumeric/underscore followed by key characters. */
const KEY_PATTERN = "[A-Za-z0-9_][\\w:.#$%&+?<>~/-]*";

/** Matches an `@citekey` preceded by a valid Pandoc prefix. */
const CITEKEY_RE = new RegExp(`(?:^|[\\s[;(])@(${KEY_PATTERN})`, "g");

/**
 * Extract unique Pandoc citekeys from text in first-seen order.
 *
 * Trailing punctuation (`.,;:`) is stripped from each key. Email-shaped
 * strings are not matched because they lack a valid `@` prefix.
 *
 * @param text - Arbitrary markdown/text content to scan.
 * @returns Unique citekeys in the order they first appear.
 */
export function extractCitekeys(text: string): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const match of text.matchAll(CITEKEY_RE)) {
    const key = match[1].replace(/[.,;:]+$/, "");
    if (!key) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(key);
  }

  return result;
}
