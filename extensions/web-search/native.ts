/**
 * Native HTTP (Bing RSS) fallback for web-search extension.
 * Only used when both SearXNG and Tavily are unavailable.
 */

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  source_label: string;
  tier: number;
}

/**
 * Minimal Bing RSS feed fetch.
 */
export async function searchNativeHttp(
  query: string,
  tier: number,
  signal?: AbortSignal,
): Promise<SearchResult[]> {
  let searchQuery = query;
  if (tier === 2) searchQuery = `(${query}) (site:edu OR site:ac.uk OR site:gov)`;

  const url = "https://www.bing.com/search?q=" + encodeURIComponent(searchQuery) + "&format=rss";

  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        Accept: "application/rss+xml, application/xml",
      },
      signal,
    });
    if (!response.ok) return [];

    const xml = await response.text();
    const results: SearchResult[] = [];
    const seen = new Set<string>();
    const itemRe = /<item>([\s\S]*?)<\/item>/gi;
    let match: RegExpExecArray | null;

    while ((match = itemRe.exec(xml)) !== null && results.length < 10) {
      const block = match[1];
      const titleM = block.match(/<title>([^<]*)<\/title>/i);
      const linkM = block.match(/<link>([^<]+)<\/link>/i);
      if (!titleM || !linkM) continue;
      const title = titleM[1].trim();
      const link = linkM[1].trim();
      if (!title || !link || seen.has(link)) continue;
      seen.add(link);

      const descM = block.match(/<description>([\s\S]*?)<\/description>/i);
      const snippet = descM
        ? descM[1]
            .replace(/<[^>]*>/g, "")
            .replace(/&#?\w+;/g, " ")
            .replace(/\s+/g, " ")
            .trim()
        : "";

      results.push({
        title,
        url: link,
        snippet: snippet.length > 300 ? snippet.slice(0, 300) + "..." : snippet,
        source_label: "Web",
        tier,
      });
    }
    return results;
  } catch {
    return [];
  }
}
