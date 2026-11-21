/**
 * Deterministic greedy word wrapping for rendered markdown.
 *
 * Wrapping counts the line prefix (for example a markdown bullet) against the
 * requested width so rendered lines stay within markdownlint's MD013 limit.
 */

/** Optional prefixes applied to the first and continuation lines. */
export interface WrapOptions {
  firstPrefix?: string;
  restPrefix?: string;
}

/**
 * Wrap text on whitespace into lines no wider than the requested width.
 *
 * A word longer than the available width is emitted on its own line rather
 * than being split. The first line uses `firstPrefix`; every wrapped line
 * uses `restPrefix`. Both prefixes count toward the width.
 *
 * @param text - Text to wrap; existing whitespace runs are collapsed.
 * @param width - Maximum rendered line width, including prefixes.
 * @param opts - Optional first-line and continuation prefixes.
 * @returns Wrapped lines, or an empty array for blank input.
 */
export function wrapText(text: string, width: number, opts: WrapOptions = {}): string[] {
  const firstPrefix = opts.firstPrefix ?? "";
  const restPrefix = opts.restPrefix ?? "";

  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];

  const lines: string[] = [];
  let prefix = firstPrefix;
  let current: string[] = [];
  let currentLength = 0;

  const flush = (): void => {
    if (current.length === 0) return;
    lines.push(prefix + current.join(" "));
    prefix = restPrefix;
    current = [];
    currentLength = 0;
  };

  for (const word of words) {
    const capacity = Math.max(width - prefix.length, 0);

    if (word.length > capacity) {
      flush();
      lines.push(prefix + word);
      prefix = restPrefix;
      continue;
    }

    if (current.length === 0) {
      current.push(word);
      currentLength = word.length;
      continue;
    }

    if (currentLength + 1 + word.length <= capacity) {
      current.push(word);
      currentLength += 1 + word.length;
      continue;
    }

    flush();
    current.push(word);
    currentLength = word.length;
  }

  flush();
  return lines;
}
