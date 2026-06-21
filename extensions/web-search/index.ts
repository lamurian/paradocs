/**
 * web-search — tool wrapper around common/webSearch.ts.
 *
 * Thin adapter: parses params via typebox, delegates to the shared
 * searchWeb function, and formats the result for tool output.
 *
 * @module extensions/web-search/index
 */

import { Type } from "typebox";

import { searchWeb, formatResults } from "../../common/webSearch.js";

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI): void {
  pi.registerTool({
    name: "web_search",
    label: "Web Search (3-Phase: SearXNG -> Tavily -> Bing RSS)",
    description:
      "Three-phase web search: SearXNG category-based search (1→2→3), then Tavily, then Bing RSS with domain filtering (Phase 3 only). " +
      "Tier 1 — scientific_publications category (academic papers, peer-reviewed research). " +
      "Tier 2 — web category with site:edu|gov filtering (authoritative non-academic). Override via category: " +
      "'it' for tech/software, 'news' for news, 'web' for filtered web. " +
      "Tier 3 — general category (broad exploration, blogs, any web). " +
      "Fallback chain (when no tier forced): SearXNG >3 results → Tavily → Bing RSS (domain-filtered).",
    promptSnippet:
      "Search the web (3-phase: SearXNG academic -> filtered -> general, then Tavily, then Bing RSS). Use tier=1 for academic, tier=2 for filtered web (default site:edu|gov), tier=3 for general. Pass category='it' for tech/software, 'news' for news queries, etc.",
    parameters: Type.Object({
      query: Type.String({ description: "The search query" }),
      tier: Type.Optional(
        Type.Number({
          description:
            "Force a specific SearXNG tier: 1 (academic / scientific_publications), 2 (filtered web), 3 (general). Omit to run all three in order.",
        }),
      ),
      category: Type.Optional(
        Type.String({
          description:
            "Override SearXNG category for the chosen tier. Useful for context-aware tier 2: 'it' for software/tech, 'news' for news, 'web' for general web. Only applied when tier is set. See @.pi/extensions/web-search/AGENTS.md for all supported categories.",
        }),
      ),
    }),

    async execute(_toolCallId, params, signal, _onUpdate, _ctx) {
      const { query, tier, category } = params;
      const {
        results,
        tier: usedTier,
        tierLabel,
      } = await searchWeb(query, { tier, category, signal });
      return {
        content: [{ type: "text" as const, text: formatResults(results, query, tierLabel) }],
        details: {
          query,
          tier: usedTier,
          category: category ?? null,
          tierLabel,
          count: results.length,
          results: results.map((r) => ({
            title: r.title,
            url: r.url,
            snippet: r.snippet,
            source_label: r.source_label,
            tier: r.tier,
          })),
        },
      };
    },
  });
}
