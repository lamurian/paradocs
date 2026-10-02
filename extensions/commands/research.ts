/**
 * /research command — research engine flow.
 *
 * Decomposes a topic via WHY/HOW/WHAT, feeds all resulting questions to the
 * research engine in a single parallel invocation, writes results back to the
 * knowledge base (KNOWLEDGE_DIR from .env), and synthesizes a research report.
 *
 * @module extensions/commands/research
 */

import { DECOMPOSITION_PROMPT } from "./research-format.js";
import { extractJson } from "../../common/extractJson.js";
import { callLlmDirect, callLlmWithLoader } from "../../common/llm.js";
import { runResearchEngine } from "../research-engine/runner.js";
import { writeBackToKB } from "../research-engine/writeback.js";

import type { LlmCallResult } from "../../common/llm.js";
import type { Api, Model } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

/** Human-readable description shown in /commands list. */
export const description = "Run iterative academic research on a topic";

/** System prompt: synthesize a research report from collected sources. */
export const SYNTHESIS_PROMPT = `Synthesize a comprehensive research report for the topic using the collected web sources below.

Structure the report with short markdown sections. Cite sources inline by their URL in parentheses.
Do not mention the research process. Return ONLY the report text.`;

/** One branch of the WHY/HOW/WHAT question tree. */
interface QuestionBranch {
  question: string;
  supporting: string[];
}

/** WHY/HOW decomposition tree produced by the DECOMPOSITION_PROMPT. */
export interface QuestionTree {
  why: QuestionBranch;
  how: QuestionBranch;
}

/**
 * Parse a decomposition LLM response into a question tree.
 *
 * @param text - Raw LLM response text.
 * @returns The question tree, or null when invalid.
 */
export function parseQuestionTree(text: string): QuestionTree | null {
  const parsed = extractJson(text);
  if (parsed === null || typeof parsed !== "object") return null;
  const tree = parsed as Partial<QuestionTree>;
  if (!tree.why || !tree.how || typeof tree.why.question !== "string") return null;
  return tree as QuestionTree;
}

/**
 * Flatten a question tree into a research question list.
 *
 * @param tree - The WHY/HOW/WHAT decomposition tree.
 * @param topic - Fallback topic used when the tree is empty.
 * @returns All questions from both branches, filtered and deduplicated.
 */
export function flattenQuestionTree(tree: QuestionTree, topic: string): string[] {
  const raw = [
    tree.why.question,
    ...(Array.isArray(tree.why.supporting) ? tree.why.supporting : []),
    tree.how.question,
    ...(Array.isArray(tree.how.supporting) ? tree.how.supporting : []),
  ];
  const qs = raw
    .filter((q): q is string => typeof q === "string" && q.trim().length > 0)
    .map((q) => q.trim());
  return qs.length > 0 ? [...new Set(qs)] : [topic];
}

/**
 * Resolve model authentication for LLM calls.
 *
 * @param ctx - The extension command context.
 * @returns Auth info, or null after notifying the user on failure.
 */
async function resolveAuth(ctx: ExtensionCommandContext): Promise<{
  apiKey: string;
  headers?: Record<string, string>;
} | null> {
  const model = ctx.model as Model<Api>;
  try {
    const result = await ctx.modelRegistry.getApiKeyAndHeaders(model);
    if (!result.ok || !result.apiKey) {
      ctx.ui.notify(`❌ No API key for ${model.provider}`, "error");
      return null;
    }
    return { apiKey: result.apiKey, headers: result.headers };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    ctx.ui.notify(`❌ Auth error: ${msg}`, "error");
    return null;
  }
}

/**
 * Run an LLM call with TUI loader or direct call depending on mode.
 *
 * @param ctx - The extension command context.
 * @param loaderText - Loader text for TUI mode.
 * @param systemPrompt - The system prompt.
 * @param userText - The user message text.
 * @param parseFn - Response parser.
 * @returns The LLM call result.
 */
async function runLlm<T>(
  ctx: ExtensionCommandContext,
  loaderText: string,
  systemPrompt: string,
  userText: string,
  parseFn: (text: string) => T | null,
): Promise<LlmCallResult<T>> {
  const model = ctx.model as Model<Api>;
  const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
  if (!auth.ok || !auth.apiKey) {
    return { ok: false, type: "error", message: "No API key" };
  }
  const authInfo = { apiKey: auth.apiKey, headers: auth.headers };
  const messageContent = [{ type: "text" as const, text: userText }];

  if (ctx.mode === "tui") {
    return ctx.ui
      .custom<LlmCallResult<T> | null>((tui, theme, _kb, done) =>
        callLlmWithLoader(
          tui,
          theme,
          done,
          loaderText,
          model,
          authInfo,
          systemPrompt,
          messageContent,
          parseFn,
        ),
      )
      .then((r) => r ?? { ok: false, type: "cancelled" as const });
  }
  return callLlmDirect<T>(model, authInfo, systemPrompt, messageContent, parseFn);
}

/**
 * Create the /research command handler.
 *
 * Flow: WHY/HOW/WHAT decomposition → research engine (single parallel call)
 * → KB write-back → synthesis of a research report.
 *
 * @param pi - The pi extension API instance.
 * @returns The command handler function.
 */
export function createHandler(pi: ExtensionAPI) {
  return async (args: string, ctx: ExtensionCommandContext): Promise<void> => {
    const topic = args.trim();
    if (!topic) {
      ctx.ui.notify("Usage: /research <topic> — please provide a research topic.", "warning");
      return;
    }
    if (!ctx.model) {
      ctx.ui.notify("No model selected. Please select a model first (Ctrl+P).", "error");
      return;
    }
    ctx.ui.notify(`🔬 Researching: "${topic.slice(0, 80)}…"`, "info");

    const auth = await resolveAuth(ctx);
    if (!auth) return;

    // Step 1: WHY/HOW/WHAT decomposition
    const decomp = await runLlm<QuestionTree>(
      ctx,
      "Decomposing research topic...",
      DECOMPOSITION_PROMPT,
      topic,
      parseQuestionTree,
    );
    if (!decomp.ok && decomp.type === "cancelled") {
      ctx.ui.notify("Research cancelled.", "info");
      return;
    }
    const questions = decomp.ok ? flattenQuestionTree(decomp.value, topic) : [topic];

    // Step 2: Research engine — all questions in one parallel invocation
    const result = await runResearchEngine(questions, ctx);

    // Step 3: KB write-back (KNOWLEDGE_DIR from .env)
    const writeback = await writeBackToKB(result, {
      cwd: ctx.cwd,
      model: ctx.model,
      modelRegistry: ctx.modelRegistry,
    });

    // Step 4: Synthesize the research report
    const sourcesStr = result.sources.map((s) => `- ${s.url}: ${s.snippet}`).join("\n");
    const synth = await runLlm<string>(
      ctx,
      "Synthesizing research report...",
      SYNTHESIS_PROMPT,
      `Topic: ${topic}\n\nSources:\n${sourcesStr || "(none)"}`,
      (text) => text.trim(),
    );
    const report = synth.ok && synth.value ? synth.value : "_(synthesis unavailable)_";

    const wbLines = [
      ...writeback.created.map((p) => `created: ${p}`),
      ...writeback.updated.map((p) => `updated: ${p}`),
      ...writeback.skipped.map((s) => `skipped: ${s}`),
    ];
    pi.sendUserMessage(
      `## Research Report: ${topic}\n\n${report}\n\n---\n` +
        `📄 Knowledge base (KNOWLEDGE_DIR):\n${wbLines.join("\n") || "(no changes)"}`,
    );
  };
}
