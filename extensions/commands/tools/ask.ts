/**
 * ask tool — knowledge base search returning full document context.
 *
 * The agent calls this when it needs supporting information to answer the
 * user's question. It searches notes.db (FTS5 BM25) and returns matching
 * document titles, paths, full bodies, tags, and scores. The agent's own
 * LLM evaluates whether the existing knowledge is sufficient or whether
 * web search is needed.
 *
 * @module extensions/commands/tools/ask
 */

import { Type } from "typebox";

import { configureEnv } from "../../../common/env.js";
import { ensureNotesDb } from "../../../common/notesDb.js";
import { searchDocs } from "../../para-knowledge/db-sqlite.js";

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/**
 * Register the ask tool.
 */
export function registerAskTool(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "ask",
    label: "Ask the Knowledge Base",
    description:
      "Search the PARA knowledge base and return full document context for a question. " +
      "Returns matching document titles, paths, full bodies, tags, and relevance scores. " +
      "Use this first when you need supporting information to answer the user's question.",
    promptSnippet:
      "Use this tool first when you need supporting information to answer the user's question. " +
      "It searches the PARA knowledge base and returns full document context.",
    promptGuidelines: [
      "Call ask before searching the web — existing knowledge may be sufficient.",
      "If the returned documents fully answer the question, cite them by path with @citekey and answer directly.",
      "If gaps remain, search the web, fetch sources, resolve citations, and create new atomic notes.",
      "Every new source must be resolved via resolve_citation before being referenced.",
    ],
    parameters: Type.Object({
      question: Type.String({ description: "The question to search the knowledge base for" }),
    }),

    async execute(_toolCallId, params, _signal, onUpdate, ctx) {
      configureEnv(ctx.cwd);

      onUpdate?.({
        content: [{ type: "text" as const, text: "🗄️ Searching knowledge base…" }],
        details: {},
      });

      const question = (params.question ?? "").trim();
      if (!question) {
        return {
          content: [{ type: "text" as const, text: "📭 No question provided." }],
          details: { results: [], count: 0 },
        };
      }

      try {
        const db = await ensureNotesDb(ctx.cwd);
        const results = searchDocs(db, question);

        if (results.length === 0) {
          return {
            content: [
              {
                type: "text" as const,
                text: `📭 No documents found for: "${question}". You may need to search the web and create new knowledge documents.`,
              },
            ],
            details: { results: [], count: 0 },
          };
        }

        const context = results
          .map(
            (r) =>
              `## ${r.title} (\`${r.path}\`)\n` +
              `Tags: ${r.tags.join(", ") || "(none)"}\n` +
              `Relevance: ${r.matchedByTag ? "tag-only" : r.score < -0.001 ? "good" : "weak"}\n` +
              `---\n${r.body}`,
          )
          .join("\n\n---\n\n");

        const summary = results
          .map(
            (r) =>
              `- [${r.title}](${r.path})  (relevance: ${r.matchedByTag ? "tag-only" : r.score < -0.001 ? "good" : "weak"})`,
          )
          .join("\n");

        return {
          content: [
            {
              type: "text" as const,
              text:
                `🗄️ **${results.length} document${results.length === 1 ? "" : "s"} found for:** "${question}"\n\n` +
                `${summary}\n\n` +
                `---\n\n` +
                `### Full Document Context\n\n${context}`,
            },
          ],
          details: { results, count: results.length },
        };
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error("[ask tool] Error:", msg);
        return {
          content: [
            { type: "text" as const, text: `❌ Knowledge base search error: ${msg.slice(0, 200)}` },
          ],
          details: { results: [], count: 0, error: msg },
        };
      }
    },
  });
}
