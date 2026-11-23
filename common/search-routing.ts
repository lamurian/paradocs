/**
 * Web-search routing by explicit search kind.
 *
 * Maps a coarse kind to the SearXNG category string and the Tavily tier used
 * when SearXNG results do not meet the prefetch relevance threshold.
 *
 * @module common/search-routing
 */

/** Coarse search intent used to route web searches. */
export type SearchKind = "general" | "tech" | "academic" | "news";

/** Route details for one search kind. */
export interface SearchRoute {
  category: string;
  tavilyTier: number;
}

const ROUTES: Record<SearchKind, SearchRoute> = {
  general: { category: "general", tavilyTier: 3 },
  tech: { category: "it,general", tavilyTier: 3 },
  academic: { category: "scientific_publications", tavilyTier: 1 },
  news: { category: "news", tavilyTier: 3 },
};

/**
 * Resolve the SearXNG category and Tavily tier for a search kind.
 *
 * @param kind - Explicit search kind.
 * @returns The category string and Tavily tier for that kind.
 */
export function routeForKind(kind: SearchKind): SearchRoute {
  return ROUTES[kind];
}
