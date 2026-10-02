/**
 * ask tool — full research pipeline for the agent.
 *
 * Reformulates the question into 1-3 research questions, runs the research
 * engine (KB-first subagents), writes results back to the knowledge base
 * (KNOWLEDGE_DIR from .env, not cwd), and returns sources, note paths, and
 * a synthesized answer.
 *
 * @module extensions/commands/tools/ask
 */

import { Type } from "typebox";

import { configureEnv } from "../../../common/env.js";
import { callLlmDirect } from "../../../common/llm.js";
import { runResearchEngine } from "../../research-engine/runner.js";
import { writeBackToKB } from "../../research-engine/writeback.js";
import { parseQuestions, REFORMULATION_PROMPT, SYNTHESIS_PROMPT } from "../ask.js";

import type { Api, Model } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

/** Resolved authentication for the research pipeline. */
interface ToolAuth {
  model: Model<Api>;
  apiKey: string;
  headers?: Record<string, string>;
}

/**
 * Resolve the model and API key for the research pipeline.
 *
 * @param ctx - The tool extension context.
 * @returns Auth info, or an error message when unavailable.
 */
async function resolveToolAuth(
  ctx: ExtensionContext,
): Promise<{ auth: ToolAuth } | { error: string }> {
  if (!ctx.model) {
    return { error: "❌ No model selected for the research pipeline." };
  }
  const model = ctx.model as Model<Api>;
  const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
  if (!auth.ok || !auth.apiKey) {
    return { error: `❌ No API key for ${model.provider}.` };
  }
  return { auth: { model, apiKey: auth.apiKey, headers: auth.headers } };
}

/**
 * Register the ask tool.
 *
 * @param pi - The pi extension API instance.
 */
export function registerAskTool(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "ask",
    label: "Ask the Knowledge Base",
    description:
      "Full research pipeline for a question: reformulates it into 1-3 research questions, " +
      "runs KB-first research subagents (web sources, 10-50 per run), writes results back to " +
      "the knowledge base (KNOWLEDGE_DIR from .env, not the current working directory), and " +
      "returns sources, note paths, and a synthesized answer.",
    promptSnippet:
      "Full research pipeline — KB-first subagent research, knowledge base write-back, synthesized answer",
    promptGuidelines: [
      "Call ask first when you need supporting information — it researches the knowledge base and web, then improves the knowledge base.",
      "Results are written to KNOWLEDGE_DIR (from .env), not the current working directory.",
      "The tool returns {url, snippet} sources, created/updated note paths, and a synthesized answer.",
      "Consider freshness: notes on fast-moving topics (tech, AI, medicine) may be outdated even when relevant.",
    ],
    parameters: Type.Object({
      question: Type.String({ description: "The question to research" }),
    }),

    async execute(_toolCallId, params, _signal, onUpdate, ctx) {
      configureEnv(ctx.cwd);

      onUpdate?.({
        content: [{ type: "text" as const, text: "🔬 Researching knowledge base and web…" }],
        details: {},
      });

      const question = (params.question ?? "").trim();
      if (!question) {
        return {
          content: [{ type: "text" as const, text: "📭 No question provided." }],
          details: {
            sources: [],
            writeback: { created: [], updated: [], skipped: ["no question"] },
            answer: "",
          },
        };
      }

      try {
        const authResult = await resolveToolAuth(ctx);
        if ("error" in authResult) {
          return {
            content: [{ type: "text" as const, text: authResult.error }],
            details: {
              sources: [],
              writeback: { created: [], updated: [], skipped: [authResult.error] },
              answer: "",
            },
          };
        }
        const { auth } = authResult;

        // Step 1: Reformulate into 1-3 research questions
        const reform = await callLlmDirect<string[]>(
          auth.model,
          auth,
          REFORMULATION_PROMPT,
          [{ type: "text", text: `Question: ${question}` }],
          (text) => parseQuestions(text, question),
        );
        const questions = reform.ok ? reform.value : [question];

        // Step 2: Research engine + Step 3: KB write-back
        const result = await runResearchEngine(questions, ctx);
        const writeback = await writeBackToKB(result, {
          cwd: ctx.cwd,
          model: auth.model,
          modelRegistry: ctx.modelRegistry,
        });

        // Step 4: Synthesize the answer
        const sourcesStr = result.sources.map((s) => `- ${s.url}: ${s.snippet}`).join("\n");
        const synth = await callLlmDirect<string>(
          auth.model,
          auth,
          SYNTHESIS_PROMPT,
          [{ type: "text", text: `Question: ${question}\n\nSources:\n${sourcesStr || "(none)"}` }],
          (text) => text.trim(),
        );
        const answer = synth.ok && synth.value ? synth.value : "_(synthesis unavailable)_";

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
                `${wbLines.join("\n") || "(nothing written)"}\n\n` +
                `### Answer\n\n${answer}`,
            },
          ],
          details: { sources: result.sources, writeback, answer, questions },
        };
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error("[ask tool]", msg);
        return {
          content: [
            { type: "text" as const, text: `❌ Research pipeline error: ${msg.slice(0, 200)}` },
          ],
          details: {
            sources: [],
            writeback: { created: [], updated: [], skipped: [msg] },
            answer: "",
          },
        };
      }
    },
  });
}
