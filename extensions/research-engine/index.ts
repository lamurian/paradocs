/**
 * Research Engine extension — registers the research_engine tool and the
 * deterministic KB-first tool_call hook.
 *
 * The tool spawns researcher.md subagents (PI_RESEARCH_ENGINE=1) per question
 * and writes results back to the knowledge base. The hook blocks web tools
 * inside research subagents until search_para_docs has run.
 *
 * @module extensions/research-engine/index
 */

import { Type } from "typebox";

import { runResearchEngine } from "./runner.js";
import { writeBackToKB } from "./writeback.js";

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/** Tools blocked inside research subagents until the KB has been searched. */
const BLOCKED_TOOLS = new Set(["web_search", "fetch_url", "batch_extract_failed"]);

/**
 * Check whether session entries contain a completed search_para_docs tool result.
 *
 * @param entries - Session entries from ctx.sessionManager.getEntries().
 * @returns True when a toolResult message for search_para_docs exists.
 */
export function hasKbSearch(entries: unknown[]): boolean {
  return entries.some((e) => {
    const entry = e as { message?: { role?: string; toolName?: string } };
    return entry?.message?.role === "toolResult" && entry?.message?.toolName === "search_para_docs";
  });
}

/**
 * Create the deterministic KB-first tool_call hook.
 *
 * Active only when PI_RESEARCH_ENGINE=1 (research subagents). Blocks
 * web_search, fetch_url, and batch_extract_failed until search_para_docs
 * has produced a tool result in the session. Never blocks the main agent.
 *
 * @returns A tool_call event handler.
 */
export function createToolCallHook(): (
  event: { toolName: string },
  ctx: { sessionManager?: { getEntries: () => unknown[] } },
) => { block: boolean; reason: string } | undefined {
  return (event, ctx) => {
    if (process.env.PI_RESEARCH_ENGINE !== "1") return undefined;
    if (!BLOCKED_TOOLS.has(event.toolName)) return undefined;
    const entries = ctx.sessionManager?.getEntries() ?? [];
    if (hasKbSearch(entries)) return undefined;
    return {
      block: true,
      reason:
        "You must search the knowledge base first. Call search_para_docs before any web search.",
    };
  };
}

/**
 * Research engine extension entry point.
 *
 * @param pi - The pi extension API instance.
 */
export default function (pi: ExtensionAPI): void {
  pi.on("tool_call", createToolCallHook());

  pi.registerTool({
    name: "research_engine",
    label: "Research Engine",
    description:
      "Run the full research pipeline: spawns isolated researcher subagents per question " +
      "(KB search first, then tiered web search, 10-50 sources), then writes results back to " +
      "the knowledge base (KNOWLEDGE_DIR from .env, not cwd). Returns {url, snippet} sources " +
      "plus created/updated note paths.",
    promptSnippet:
      "Full research pipeline — KB-first subagent research per question, then knowledge base write-back",
    promptGuidelines: [
      "Pass 1-3 focused research questions; the engine searches the knowledge base before any web search.",
      "Results are written to KNOWLEDGE_DIR (from .env), not the current working directory.",
      "The tool reports created and updated note paths — reference them in your answer.",
    ],
    parameters: Type.Object({
      questions: Type.Array(Type.String(), {
        description: "Research questions to investigate in parallel",
      }),
    }),

    async execute(_toolCallId, params, _signal, onUpdate, ctx) {
      onUpdate?.({
        content: [{ type: "text" as const, text: "🔬 Researching knowledge base and web…" }],
        details: {},
      });

      const questions = (params.questions ?? []).map((q) => q.trim()).filter((q) => q.length > 0);
      if (questions.length === 0) {
        return {
          content: [{ type: "text" as const, text: "📭 No questions provided." }],
          details: {
            sources: [],
            writeback: { created: [], updated: [], skipped: ["no questions"] },
          },
        };
      }

      try {
        const result = await runResearchEngine(questions, ctx);
        const writeback = await writeBackToKB(result, ctx);

        const sourceLines = result.sources.map((s) => `- ${s.url}: ${s.snippet}`);
        const wbLines = [
          ...writeback.created.map((p) => `created: ${p}`),
          ...writeback.updated.map((p) => `updated: ${p}`),
          ...writeback.skipped.map((s) => `skipped: ${s}`),
        ];
        return {
          content: [
            {
              type: "text" as const,
              text:
                `🔬 Research complete: ${result.sources.length} source${result.sources.length === 1 ? "" : "s"}.\n\n` +
                `${sourceLines.join("\n") || "(no sources found)"}\n\n` +
                `Knowledge base write-back (KNOWLEDGE_DIR):\n` +
                `${wbLines.join("\n") || "(nothing written)"}`,
            },
          ],
          details: { sources: result.sources, writeback, questions },
        };
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error("[research_engine]", msg);
        return {
          content: [
            { type: "text" as const, text: `❌ Research engine error: ${msg.slice(0, 200)}` },
          ],
          details: { sources: [], writeback: { created: [], updated: [], skipped: [msg] } },
        };
      }
    },
  });
}
