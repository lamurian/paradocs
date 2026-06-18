/**
 * search_para_docs tool — FTS5 BM25-powered search across PARA documents.
 *
 * Opens notes.db (initializing if needed) and runs FTS5 BM25 search
 * with optional tag filtering. Replaces the DuckDB-based implementation.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import {
  createDb,
  initDb,
  searchDocs,
  type SearchOptions,
} from "../db-sqlite.js";

const DB_FILE = "notes.db";

/**
 * Register the search_para_docs tool.
 */
export function registerSearchDocsTool(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "search_para_docs",
    label: "Search PARA Docs",
    description:
      "Search the SQLite-indexed PARA documents (Areas/Projects/Resources) by tags and content. " +
      "Uses FTS5 BM25 ranking for text search with tag filtering.",
    promptSnippet:
      "Search for relevant knowledge documents in Areas, Projects, Resources directories",
    promptGuidelines: [
      "Use search_para_docs first when the user asks a knowledge question.",
      "Pass the user's question as query and infer relevant tags from context.",
      "Cite sources using BibTeX citation keys from @ref.bib. Use [@citekey] or @citekey inline.",
      "For existing PARA docs, reference by path — no BibTeX entry needed.",
    ],
    parameters: Type.Object({
      query: Type.String({ description: "Search query or topic" }),
      tags: Type.Optional(Type.Array(Type.String(), { description: "Filter by tag (OR logic)" })),
    }),

    async execute(_toolCallId, params, _signal, onUpdate, ctx) {
      const dbPath = resolve(ctx.cwd, DB_FILE);

      if (!existsSync(dbPath)) {
        return {
          content: [{
            type: "text" as const,
            text: "📭 No documents indexed yet. Create a document first to populate the knowledge base.",
          }],
          details: { results: [], count: 0 },
        };
      }

      onUpdate?.({
        content: [{ type: "text" as const, text: "🗄️ notes.db — searching…" }],
        details: {},
      });

      const query = params.query ?? "";
      const filterTags = params.tags ?? [];

      try {
        const db = createDb(dbPath);
        initDb(db);
        try {
          const options: SearchOptions = {};
          if (filterTags.length > 0) options.tags = filterTags;
          const results = searchDocs(db, query, options);

          if (results.length === 0) {
            return {
              content: [{
                type: "text" as const,
                text: `📭 No documents found for "${query}"${filterTags.length ? ` with tags [${filterTags.join(", ")}]` : ""}.`,
              }],
              details: { results: [], count: 0 },
            };
          }

          const list = results
            .map((r) => {
              const rel = r.matchedByTag ? "tag-only"
                : r.score < -0.001 ? "good" : "weak";
              const tagHint = r.tagMatches.length > 0
                ? ` 🏷️${r.tagMatches.slice(0, 3).join(", ")}`
                : "";
              return `- [${r.title}](${r.path})  (score: ${r.score.toFixed(2)}, relevance: ${rel}${tagHint})`;
            })
            .join("\n");

          return {
            content: [{
              type: "text" as const,
              text: `🗄️ notes.db — ${results.length} result(s):\n\n${list}`,
            }],
            details: { results, count: results.length },
          };
        } finally {
          db.close();
        }
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error("[search_para_docs] Error:", msg);
        return {
          content: [{ type: "text" as const, text: `❌ Search error: ${msg.slice(0, 200)}` }],
          details: { results: [], count: 0, error: msg },
        };
      }
    },
  });
}
