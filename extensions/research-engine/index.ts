/**
 * Research Engine extension — registers the research_engine tool and the
 * deterministic KB-first tool_call hook.
 *
 * The tool runs the FSM orchestrator in-process (KB-first, tiered web
 * search, per-source summarization, sufficiency-gated cycles, KB
 * write-back). The hook blocks web tools inside research subagents until
 * search_para_docs has run (kept for the subagent escape-hatch path).
 *
 * @module extensions/research-engine/index
 */

import { Type } from "typebox";

import { buildResearchDeps } from "./deps.js";
import { runResearch } from "./orchestrator.js";
import { ASK_DEEP_PROFILE } from "./profiles.js";
import { buildDigest } from "./state.js";
import { configureEnv } from "../../common/env.js";

import type { ResearchAuth } from "./deps.js";
import type { ResearchState } from "./state.js";
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

/** Render the tool result text from a terminal research state. */
function renderResult(state: ResearchState): string {
  const answer =
    state.synthesis && state.synthesis.trim().length > 0
      ? state.synthesis
      : `_(synthesis unavailable: ${state.synthesisError ?? "no sources collected"})_`;
  const sourceLines = state.summaries.map((s) => `- ${s.url}: ${s.summary.slice(0, 200)}`);
  const wb = state.writeback;
  const wbLines = wb
    ? [
        ...wb.created.map((p) => `created: ${p}`),
        ...wb.updated.map((p) => `updated: ${p}`),
        ...wb.skipped.map((s) => `skipped: ${s}`),
      ]
    : ["(write-back not run)"];
  const digest = buildDigest(state);
  return (
    `🔬 Research complete: ${state.summaries.length} source(s).\n\n` +
    `${sourceLines.join("\n") || "(no sources found)"}\n\n` +
    `### Answer\n\n${answer}\n\n` +
    `Knowledge base write-back (KNOWLEDGE_DIR):\n${wbLines.join("\n") || "(nothing written)"}\n\n` +
    `Digest: sources: ${digest.sourceCount}; gaps: ${digest.gaps.join("; ") || "(none)"}`
  );
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
      "Run the full research pipeline: KB-first search, tiered web search, per-source " +
      "summarization, sufficiency-gated cycles, then knowledge base write-back " +
      "(KNOWLEDGE_DIR from .env, not cwd). Returns sources, a synthesized answer, " +
      "write-back status, and a progress digest.",
    promptSnippet:
      "Full research pipeline — KB-first deterministic cycles, knowledge base write-back, synthesized answer",
    promptGuidelines: [
      "Pass 1-3 focused research questions; the engine searches the knowledge base before any web search.",
      "Results are written to KNOWLEDGE_DIR (from .env), not the current working directory.",
      "The tool reports sources, answer, write-back status, and gaps — reference them in your answer.",
    ],
    parameters: Type.Object({
      questions: Type.Array(Type.String(), {
        description: "Research questions to investigate in parallel",
      }),
    }),

    async execute(_toolCallId, params, _signal, onUpdate, ctx) {
      configureEnv(ctx.cwd);
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
        if (!ctx.model) {
          return {
            content: [
              { type: "text" as const, text: "❌ No model selected for the research engine." },
            ],
            details: {
              sources: [],
              writeback: { created: [], updated: [], skipped: ["no model"] },
            },
          };
        }
        const model = ctx.model as ResearchAuth["model"];
        const key = await ctx.modelRegistry.getApiKeyAndHeaders(model);
        if (!key.ok || !key.apiKey) {
          return {
            content: [{ type: "text" as const, text: `❌ No API key for ${model.provider}.` }],
            details: {
              sources: [],
              writeback: {
                created: [],
                updated: [],
                skipped: [`no API key for ${model.provider}`],
              },
            },
          };
        }
        const auth: ResearchAuth = { model, apiKey: key.apiKey, headers: key.headers };
        const deps = buildResearchDeps(ctx, auth, {});
        const state = await runResearch(deps, {
          question: questions.join(" | "),
          mode: "breadth",
          profile: ASK_DEEP_PROFILE,
        });
        return {
          content: [{ type: "text" as const, text: renderResult(state) }],
          details: {
            sources: state.summaries,
            writeback: state.writeback ?? { created: [], updated: [], skipped: [] },
            digest: buildDigest(state),
            questions,
          },
        };
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error("[research_engine]", msg);
        return {
          content: [
            { type: "text" as const, text: `❌ Research engine error: ${msg.slice(0, 200)}` },
          ],
          details: {
            sources: [],
            writeback: { created: [], updated: [], skipped: [msg.slice(0, 200)] },
          },
        };
      }
    },
  });
}
