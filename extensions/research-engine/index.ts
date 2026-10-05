/**
 * Research Engine extension — registers the research_engine tool.
 *
 * The tool runs the FSM orchestrator in-process (KB-first search, tiered
 * web search via the search subagent, per-source summarization,
 * sufficiency-gated cycles, KB write-back).
 *
 * @module extensions/research-engine/index
 */

import { Type } from "typebox";

import { buildResearchDeps } from "./deps.js";
import { runResearch } from "./orchestrator.js";
import { ASK_DEEP_PROFILE } from "./profiles.js";
import { renderAnswerBody, renderWritebackLines } from "./render.js";
import { buildDigest } from "./state.js";
import { configureEnv } from "../../common/env.js";

import type { ResearchAuth } from "./deps.js";
import type { ResearchState } from "./state.js";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/** Render the tool result text from a terminal research state. */
export function renderResult(state: ResearchState): string {
  const sourceLines = state.summaries.map((s) => `- ${s.url}: ${s.summary.slice(0, 200)}`);
  const digest = buildDigest(state);
  return (
    `Research complete: ${state.summaries.length} source(s).\n\n` +
    `${sourceLines.join("\n") || "(no sources found)"}\n\n` +
    `### Answer\n\n${renderAnswerBody(state)}\n\n` +
    `Knowledge base write-back (KNOWLEDGE_DIR):\n${renderWritebackLines(state.writeback).join("\n")}\n\n` +
    `Digest: sources: ${digest.sourceCount}; gaps: ${digest.gaps.join("; ") || "(none)"}`
  );
}

/**
 * Research engine extension entry point.
 *
 * @param pi - The pi extension API instance.
 */
export default function (pi: ExtensionAPI): void {
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
        content: [{ type: "text" as const, text: "Researching knowledge base and web…" }],
        details: {},
      });

      const questions = (params.questions ?? []).map((q) => q.trim()).filter((q) => q.length > 0);
      if (questions.length === 0) {
        return {
          content: [{ type: "text" as const, text: "No questions provided." }],
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
              { type: "text" as const, text: "No model selected for the research engine." },
            ],
            details: {
              sources: [],
              writeback: { created: [], updated: [], skipped: ["no model"] },
            },
          };
        }
        // Subprocesses resolve credentials themselves from ~/.pi/agent/auth.json.
        const auth: ResearchAuth = { model: ctx.model };
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
          content: [{ type: "text" as const, text: `Research engine error: ${msg.slice(0, 200)}` }],
          details: {
            sources: [],
            writeback: { created: [], updated: [], skipped: [msg.slice(0, 200)] },
          },
        };
      }
    },
  });
}
