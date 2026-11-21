/**
 * Tavily extract API for link-summarizer.
 * Last-resort fallback when both Obscura (CDP) and HTTP extraction fail.
 *
 * Tavily handles JavaScript rendering, making it suitable for SPAs and
 * JS-heavy pages that Obscura could not reach.
 *
 * @module extensions/link-summarizer/tavily-extract
 */

import { tavily } from "@tavily/core";

import { getApiKeys } from "../../common/env.ts";

/** Extracted content returned by a successful Tavily extract. */
export interface TavilyExtractContent {
  title: string;
  content: string;
}

/**
 * Extract a single URL via Tavily's extract API.
 *
 * The API key is read from TAVILY_KEY. On success returns the extracted
 * title and raw markdown content; on failure returns an error string.
 *
 * @param url    - The URL to extract.
 * @param signal - Optional AbortSignal for cancellation.
 * @returns Extracted content, or `{ error }` when extraction fails.
 */
export async function extractWithTavily(
  url: string,
  signal?: AbortSignal,
): Promise<TavilyExtractContent | { error: string }> {
  if (signal?.aborted) {
    return { error: "Cancelled by caller" };
  }

  const apiKey = getApiKeys().tavily;
  if (!apiKey) {
    return { error: "TAVILY_KEY environment variable not set" };
  }

  try {
    const client = tavily({ apiKey });
    const response = await client.extract([url], {
      format: "markdown",
      extractDepth: "advanced",
    });

    const result = response.results[0];
    if (result) {
      return {
        title: result.title ?? "(no title)",
        content: result.rawContent,
      };
    }

    const failed = response.failedResults[0];
    if (failed) {
      return { error: failed.error };
    }

    return { error: "Tavily extract returned no results" };
  } catch (err: unknown) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}
