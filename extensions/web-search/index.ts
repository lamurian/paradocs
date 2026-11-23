/**
 * web-search — tool wrapper around common/webSearch.ts.
 *
 * Thin adapter: parses params via typebox, delegates to the shared
 * searchWeb function, and formats the result for tool output.
 *
 * @module extensions/web-search/index
 */

import { Type } from "typebox";

import { configureEnv } from "../../common/env.ts";
import { classifyTrust } from "../../common/trust.ts";
import { searchWeb, formatResults } from "../../common/webSearch.ts";

import type { SearchKind } from "../../common/search-routing.ts";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI): void {
  pi.registerTool({
    name: "web_search",
    label: "Web Search (3-Phase: SearXNG -> Tavily -> Bing RSS)",
    description:
      "Three-phase web search routed by kind: SearXNG category-based search, then Tavily, then Bing RSS with domain filtering (Phase 3 only). " +
      "Kinds: 'general' (default), 'tech' for software/library/API/docs questions, 'academic' for research literature only, 'news' for current events. " +
      "Fallback chain: SearXNG results that clear the prefetch threshold -> Tavily -> Bing RSS (domain-filtered).",
    promptSnippet:
      "Search the web (SearXNG by kind -> Tavily -> Bing RSS). Pass kind='tech' for software/library/API/docs, 'academic' only for research literature, 'news' for current events; default is 'general'.",
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
      kind: Type.Optional(
        Type.Union(
          [
            Type.Literal("general"),
            Type.Literal("tech"),
            Type.Literal("academic"),
            Type.Literal("news"),
          ],
          {
            description:
              "Search kind: general (default), tech for software/library/API/docs questions, academic for research literature only, news for current events.",
          },
        ),
      ),
    }),

    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      configureEnv(ctx.cwd);

      const { query, tier, category, kind } = params;
      const usedKind: SearchKind = kind ?? "general";
      const {
        results,
        tier: usedTier,
        tierLabel,
      } = await searchWeb(query, { tier, category, kind: usedKind, signal });
      return {
        content: [{ type: "text" as const, text: formatResults(results, query, tierLabel) }],
        details: {
          query,
          kind: usedKind,
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
            trust: classifyTrust(r.url),
          })),
        },
      };
    },
  });
}
