/**
 * Tavily extract API for link-summarizer.
 * Last-resort fallback when both Obscura (CDP) and HTTP extraction fail.
 *
 * Accumulates URLs that failed all prior extraction methods and
 * batch-processes them via Tavily's extract API in a single request.
 * Tavily handles JavaScript rendering, making it suitable for SPAs
 * and JS-heavy pages that Obscura could not reach.
 */

import { tavily } from "@tavily/core";

/**
 * Module-level accumulator for URLs where both Obscura and HTTP
 * extraction failed. Same URL is never added twice (Set).
 */
const pendingUrls: Set<string> = new Set();

/** Add a URL to the pending extraction queue. */
export function addFailedUrl(url: string): void {
  pendingUrls.add(url);
}

/** Get all currently pending URLs. */
export function getPendingUrls(): string[] {
  return [...pendingUrls];
}

/** Clear the pending queue. No-op if already empty. */
export function clearPending(): void {
  pendingUrls.clear();
}

/** Check whether any URLs are pending batch extraction. */
export function hasPending(): boolean {
  return pendingUrls.size > 0;
}

/** Result for a single extracted URL. */
export interface BatchExtractResult {
  url: string;
  title: string | null;
  markdown: string;
  success: boolean;
  error?: string;
}

/**
 * Extract content from all accumulated URLs via Tavily's extract API.
 *
 * Processes all pending URLs in a single network request, then clears
 * the queue. Each URL returns either a successful result (markdown
 * content) or a failure record with an error message.
 *
 * @param options - optional overrides (format, extractDepth)
 * @returns array of per-URL results
 */
export async function extractBatch(
  options?: {
    format?: "markdown" | "text";
    extractDepth?: "basic" | "advanced";
  },
): Promise<BatchExtractResult[]> {
  const apiKey = process.env.TAVILY_KEY;
  if (!apiKey) {
    throw new Error("TAVILY_KEY environment variable not set");
  }

  const urls = getPendingUrls();
  if (urls.length === 0) return [];

  const client = tavily({ apiKey });

  const response = await client.extract(urls, {
    format: options?.format ?? "markdown",
    extractDepth: options?.extractDepth ?? "advanced",
  });

  // Clear queue — caller can re-queue individual URLs if needed
  clearPending();

  const results: BatchExtractResult[] = [];

  for (const r of response.results) {
    results.push({
      url: r.url,
      title: r.title,
      markdown: r.rawContent,
      success: true,
    });
  }

  for (const f of response.failedResults) {
    results.push({
      url: f.url,
      title: null,
      markdown: "",
      success: false,
      error: f.error,
    });
  }

  return results;
}
