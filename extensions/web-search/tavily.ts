/**
 * Tavily search API backend for web-search extension.
 * Fallback when SearXNG is unavailable.
 */

const ACADEMIC_DOMAINS = [
  "pubmed.ncbi.nlm.nih.gov",
  "arxiv.org",
  "semanticscholar.org",
  "openalex.org",
  "doi.org",
  "ncbi.nlm.nih.gov",
  "science.org",
  "nature.com",
  "springer.com",
  "ieee.org",
  "acm.org",
];

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  source_label: string;
  tier: number;
}

/**
 * Query Tavily API. Requires TAVILY_KEY environment variable.
 */
export async function searchTavily(
  query: string,
  tier: number,
  signal?: AbortSignal,
): Promise<SearchResult[]> {
  const apiKey = process.env.TAVILY_KEY;
  if (!apiKey) return [];

  const body: Record<string, unknown> = {
    api_key: apiKey,
    query,
    max_results: 10,
    include_answer: false,
  };

  if (tier === 1) {
    body.search_depth = "advanced";
    body.include_domains = ACADEMIC_DOMAINS;
  } else if (tier === 2) {
    body.search_depth = "basic";
    body.include_domains = [".edu", ".gov", ".ac.uk"];
  } else {
    body.search_depth = "advanced";
  }

  try {
    const response = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
    if (!response.ok) return [];
    const data = (await response.json()) as { results?: Array<Record<string, unknown>> };
    return (data.results ?? []).slice(0, 10).map((r) => ({
      title: (r.title as string) ?? "",
      url: (r.url as string) ?? "",
      snippet: ((r.content as string) ?? "").slice(0, 300),
      source_label: "Tavily",
      tier,
    }));
  } catch {
    return [];
  }
}
