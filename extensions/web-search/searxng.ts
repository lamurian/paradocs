/**
 * SearXNG search backend for web-search extension.
 * Primary search via Docker container on port 8888.
 *
 * Uses HTTP GET with category-based API (categories parameter) and safesearch=1.
 * See AGENTS.md in this directory for full parameter reference.
 */

const SEARXNG_PORT = parseInt(process.env.SEARXNG_PORT || "8888", 10);

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  source_label: string;
  tier: number;
}

/**
 * Query SearXNG JSON API via GET with category-based filtering.
 *
 * Tier mapping (when category not overridden):
 *   1 — scientific_publications category (academic papers, preprints)
 *   2 — web category with site:.edu OR site:.gov query modifier
 *   3 — general category (unrestricted web search)
 *
 * The `category` parameter, when provided, overrides the tier's default
 * category and disables automatic query modification.
 *
 * @param query - The raw search query string
 * @param tier - Tier 1 (academic), 2 (filtered web), or 3 (general)
 * @param signal - Optional AbortSignal for cancellation
 * @param category - Optional SearXNG category override (e.g. "it", "news")
 */
export async function searchSearxng(
  query: string,
  tier: number,
  signal?: AbortSignal,
  category?: string,
): Promise<SearchResult[]> {
  const baseUrl = `http://127.0.0.1:${SEARXNG_PORT}/search`;
  const params = new URLSearchParams();
  params.set("format", "json");
  params.set("safesearch", "1");
  params.set("language", "en");
  params.set("pageno", "1");

  if (category) {
    // Custom category override — pass query through unmodified
    params.set("categories", category);
    params.set("q", query);
  } else if (tier === 1) {
    // Academic literature
    params.set("categories", "scientific_publications");
    params.set("q", query);
  } else if (tier === 2) {
    // Filtered web — authoritative domains
    params.set("categories", "web");
    params.set("q", `${query} site:edu OR site:gov`);
  } else {
    // Tier 3 — general unrestricted web search
    params.set("categories", "general");
    params.set("q", query);
  }

  const url = `${baseUrl}?${params.toString()}`;
  let response: Response;
  try {
    // Use a 30-second timeout for local SearXNG. Respect the pi signal
    // (user cancellation) by aborting our controller when it fires.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new DOMException("Timed out", "TimeoutError")), 30_000);
    if (signal) {
      signal.addEventListener("abort", () => controller.abort(signal.reason), { once: true });
    }
    try {
      response = await fetch(url, { signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return [];
  }
  if (!response.ok) return [];

  let data: { results?: Array<Record<string, unknown>> };
  try {
    data = (await response.json()) as typeof data;
  } catch {
    return [];
  }

  // With category-based queries, multiple engines each return results.
  // Increase slice to capture diversity across all engines in the category.
  return (data.results ?? []).slice(0, 50).map((r) => ({
    title: (r.title as string) ?? "",
    url: (r.url as string) ?? "",
    snippet: ((r.content as string) ?? "").replace(/<[^>]*>/g, "").slice(0, 300),
    source_label: (r.engine as string) ?? "SearXNG",
    tier,
  }));
}
