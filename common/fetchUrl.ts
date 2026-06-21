/**
 * Shared URL fetching module — tiered extraction pipeline.
 *
 * 1. PDF detection → pdftotext
 * 2. Obscura CDP → headless browser markdown
 * 3. HTTP fallback → HTML stripping
 * 4. If all fail → return { error }
 *
 * Tavily batch extraction (for failed URLs) stays in the
 * link-summarizer tool — this module only covers the primary chain.
 *
 * @module common/fetchUrl
 */

import { tryObscura } from "../extensions/link-summarizer/cdp.js";
import { fetchViaHttp } from "../extensions/link-summarizer/http.js";
import { tryExtractPdf, isPdfUrl } from "../extensions/link-summarizer/pdf.js";

// ── Constants ───────────────────────────────────────────────────────

const MAX_CONTENT_CHARS = 80_000;

// ── Helpers ─────────────────────────────────────────────────────────

function truncate(text: string): { body: string; truncated: boolean } {
  if (text.length <= MAX_CONTENT_CHARS) return { body: text, truncated: false };
  return {
    body:
      text.slice(0, MAX_CONTENT_CHARS) +
      `\n\n[... content truncated to ${MAX_CONTENT_CHARS.toLocaleString()} characters ...]`,
    truncated: true,
  };
}

function formatContent(
  title: string,
  url: string,
  body: string,
  engine: string,
): { title: string; content: string; engine: string } {
  return {
    title,
    content: body,
    engine,
  };
}

// ── Extraction pipeline ─────────────────────────────────────────────

async function handlePdf(
  url: string,
  signal?: AbortSignal,
): Promise<{ title: string; content: string; engine: string } | null> {
  const result = await tryExtractPdf(url, signal);
  if (!result) return null;
  const { title, text } = result;
  const { body } = truncate(text);
  return formatContent(title, url, body, "pdftotext");
}

async function handleHtml(
  url: string,
  signal?: AbortSignal,
): Promise<{ title: string; content: string; engine: string } | { error: string }> {
  // Try Obscura CDP first
  const obsResult = await tryObscura(url, signal);
  if (obsResult) {
    const { title, markdown } = obsResult;
    const { body } = truncate(markdown);
    return formatContent(title, url, body, "obscura-cdp");
  }

  // Fallback to HTTP
  const httpResult = await fetchViaHttp(url, signal);
  if ("error" in httpResult) {
    // If HTTP says PDF, try PDF extraction
    if (httpResult.error === "PDF_CONTENT_TYPE") {
      const pdfResult = await tryExtractPdf(url, signal);
      if (pdfResult) {
        const { title, text } = pdfResult;
        const { body } = truncate(text);
        return formatContent(title, url, body, "pdftotext");
      }
    }
    return { error: httpResult.error };
  }

  const { title, text } = httpResult;
  const { body } = truncate(text);
  return formatContent(title || "(no title)", url, body, "http-fallback");
}

// ── Main export ─────────────────────────────────────────────────────

/**
 * Fetch a URL and extract its content as text/markdown.
 *
 * Pipeline:
 * 1. PDF detection (URL-based) → pdftotext
 * 2. Obscura headless browser (CDP WebSocket)
 * 3. HTTP fallback with HTML stripping
 * 4. If HTTP response is PDF → pdftotext
 *
 * Returns structured content on success, or { error } on failure.
 *
 * @param url    - The URL to fetch.
 * @param signal - Optional AbortSignal for cancellation.
 * @returns Content with title, body, and engine label, or an error object.
 */
export async function fetchUrlAsText(
  url: string,
  signal?: AbortSignal,
): Promise<{ title: string; content: string; engine: string } | { error: string }> {
  // Validate URL
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { error: `Invalid URL: ${url}` };
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    return { error: `Unsupported protocol: ${parsed.protocol}` };
  }

  // PDF detection by URL
  if (isPdfUrl(url)) {
    const pdfResult = await handlePdf(url, signal);
    if (pdfResult) return pdfResult;
  }

  // HTML pipeline (Obscura → HTTP → PDF fallback)
  return await handleHtml(url, signal);
}
