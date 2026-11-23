/**
 * Shared URL fetching module — tiered extraction pipeline.
 *
 * 1. PDF detection → pdftotext
 * 2. Obscura CDP → headless browser markdown
 * 3. HTTP fallback → HTML stripping
 * 4. Junk-page check (captcha / redirect stub) on HTML results
 * 5. Tavily extract fallback (when TAVILY_KEY is set)
 * 6. If all fail → return { error }
 *
 * @module common/fetchUrl
 */

import { getApiKeys } from "./env.ts";
import { detectJunkPage } from "./fetch-quality.ts";
import { tryObscura } from "../extensions/link-summarizer/cdp.ts";
import { fetchViaHttp } from "../extensions/link-summarizer/http.ts";
import { tryExtractPdf, isPdfUrl } from "../extensions/link-summarizer/pdf.ts";
import { extractWithTavily } from "../extensions/link-summarizer/tavily-extract.ts";

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

// ── Tavily fallback ──────────────────────────────────────────────────

/**
 * Decide whether a pipeline error is recoverable through Tavily extraction.
 *
 * Tavily is a last-resort extractor for pages the transport could not
 * retrieve at all. Definitive responses (HTTP status errors, PDF content
 * types, and arbitrary upstream errors) are surfaced unchanged.
 *
 * @param error - The error string returned by the HTML pipeline.
 * @returns True when Tavily extraction is worth attempting.
 */
function isRecoverableFetchError(error: string): boolean {
  return (
    error.startsWith("Fetch failed") ||
    error.startsWith("Error reading body") ||
    error === "No response body" ||
    error.startsWith("No readable text extracted")
  );
}

async function tryTavily(
  url: string,
  signal?: AbortSignal,
): Promise<{ title: string; content: string; engine: string } | null> {
  if (!getApiKeys().tavily) return null;
  const tavilyResult = await extractWithTavily(url, signal);
  if ("error" in tavilyResult) return null;
  return {
    title: tavilyResult.title,
    content: tavilyResult.content,
    engine: "tavily-extract",
  };
}

// ── Timeout wrapper ──────────────────────────────────────────────────

/**
 * Fetch a URL with an independent timeout, racing `fetchUrlAsText` against
 * a configurable timeout. The user-supplied signal (for manual cancellation)
 * is forwarded to the underlying fetch, but the timeout fires autonomously.
 *
 * @param url       - The URL to fetch.
 * @param timeoutMs - Timeout in milliseconds before returning an error.
 * @param signal    - Optional AbortSignal for external cancellation.
 * @returns Same shape as fetchUrlAsText, or { error } on timeout.
 */
export async function fetchUrlWithTimeout(
  url: string,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<{ title: string; content: string; engine: string } | { error: string }> {
  // Race fetchUrlAsText against a simple timeout promise
  const timeoutPromise = new Promise<{ error: string }>((resolve) => {
    const timer = setTimeout(() => {
      resolve({ error: `Request timed out after ${timeoutMs}ms` });
    }, timeoutMs);
    if (signal) {
      if (signal.aborted) {
        clearTimeout(timer);
        resolve({ error: "Cancelled by caller" });
        return;
      }
      signal.addEventListener(
        "abort",
        () => {
          clearTimeout(timer);
          resolve({ error: "Cancelled by caller" });
        },
        { once: true },
      );
    }
  });

  const result = await Promise.race([fetchUrlAsText(url, signal), timeoutPromise]);
  return result;
}

// ── Main export ─────────────────────────────────────────────────────

/**
 * Fetch a URL and extract its content as text/markdown.
 *
 * Pipeline:
 * 1. PDF detection (URL-based) → pdftotext
 * 2. Obscura headless browser (CDP WebSocket)
 * 3. HTTP fallback with HTML stripping
 * 4. Reject junk pages (captcha / redirect stubs)
 * 5. If HTTP response is PDF → pdftotext
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
  const result = await handleHtml(url, signal);
  if (!("error" in result)) {
    // PDF results are not quality-checked.
    if (result.engine === "pdftotext") return result;

    const junkReason = detectJunkPage(result.title, result.content);
    if (!junkReason) return result;

    // Junk page: treat like a failed fetch, trying Tavily when configured.
    const tavilyResult = await tryTavily(url, signal);
    if (tavilyResult) return tavilyResult;
    return { error: `Rejected page: ${junkReason}` };
  }

  // Last resort: Tavily extract when an API key is configured and the
  // failure was a transport/read problem rather than a definitive response.
  if (isRecoverableFetchError(result.error)) {
    const tavilyResult = await tryTavily(url, signal);
    if (tavilyResult) return tavilyResult;
  }

  return result;
}
