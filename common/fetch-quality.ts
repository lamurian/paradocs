/**
 * Junk-page detection for fetched web content.
 *
 * Identifies captcha/interstitial pages, redirect stubs, and (optionally)
 * pages with too little content so they never reach the LLM as sources.
 *
 * @module common/fetch-quality
 */

// ── Constants ───────────────────────────────────────────────────────

const CAPTCHA_PATTERN = /captcha|checking your browser|verify you are human|just a moment\.\.\./i;
const REDIRECT_TITLE_PATTERN = /^redirecting\b/i;
const REDIRECT_CONTENT_PATTERN = /redirect/i;
const CAPTCHA_SCAN_CHARS = 2000;
const REDIRECT_STUB_MAX_CHARS = 200;

// ── Helpers ─────────────────────────────────────────────────────────

function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

// ── Main export ─────────────────────────────────────────────────────

/**
 * Detect whether a fetched page is junk rather than real content.
 *
 * Checks in order: captcha/interstitial markers, redirect stubs, and a
 * configurable minimum content length.
 *
 * @param title - The page title.
 * @param content - The extracted page content.
 * @param opts - Optional settings; `minChars` enables the too-short check.
 * @returns A reason string (`"captcha"`, `"redirect-stub"`, `"too-short"`),
 * otherwise `null` for a normal page.
 */
export function detectJunkPage(
  title: string,
  content: string,
  opts?: { minChars?: number },
): string | null {
  const titleTrimmed = title.trim();
  const head = content.slice(0, CAPTCHA_SCAN_CHARS);

  if (CAPTCHA_PATTERN.test(titleTrimmed) || CAPTCHA_PATTERN.test(head)) {
    return "captcha";
  }

  const collapsed = collapseWhitespace(content);
  if (
    REDIRECT_TITLE_PATTERN.test(titleTrimmed) ||
    (collapsed.length < REDIRECT_STUB_MAX_CHARS && REDIRECT_CONTENT_PATTERN.test(collapsed))
  ) {
    return "redirect-stub";
  }

  const minChars = opts?.minChars;
  if (typeof minChars === "number" && collapsed.length < minChars) {
    return "too-short";
  }

  return null;
}
