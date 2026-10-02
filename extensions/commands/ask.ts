/**
 * /ask command — research engine flow.
 *
 * Reformulates the user question into focused research questions, runs the
 * research engine (KB-first subagents), writes results back to the knowledge
 * base (KNOWLEDGE_DIR from .env), and synthesizes a cited answer.
 *
 * @module extensions/commands/ask
 */

import { extractJson } from "../../common/extractJson.js";
import { callLlmDirect, callLlmWithLoader } from "../../common/llm.js";
import { runResearchEngine } from "../research-engine/runner.js";
import { writeBackToKB } from "../research-engine/writeback.js";

import type { LlmCallResult } from "../../common/llm.js";
import type { ResearchResult } from "../research-engine/types.js";
import type { Api, Model } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

export const description = "Ask a question and get a researched answer with KB write-back";

/** System prompt: reformulate the user question into 1-3 research questions. */
export const REFORMULATION_PROMPT = `Reformulate the user question into 1-3 focused research questions for a research engine.

Return ONLY a JSON array of strings. No markdown fences, no prose.
Example: ["What is the mechanism of X?", "What evidence links X to Y?"]

Rules:
- 1-3 questions, each under 20 words, self-contained.
- Cover distinct aspects of the original question.`;

/** System prompt: synthesize an answer from collected web sources. */
export const SYNTHESIS_PROMPT = `Synthesize a comprehensive answer to the research question using the collected web sources below.

Answer directly in markdown. Cite sources inline by their URL in parentheses.
Do not mention the research process. Return ONLY the answer text.`;

interface AuthInfo {
  apiKey: string;
  headers?: Record<string, string>;
}

/**
 * Parse a reformulation LLM response into a question array.
 *
 * @param text - Raw LLM response text.
 * @param fallback - Question to use when parsing fails.
 * @returns 1-3 research questions.
 */
export function parseQuestions(text: string, fallback: string): string[] {
  const parsed = extractJson(text);
  if (Array.isArray(parsed)) {
    const qs = parsed
      .filter((q): q is string => typeof q === "string" && q.trim().length > 0)
      .map((q) => q.trim())
      .slice(0, 3);
    if (qs.length > 0) return qs;
  }
  return [fallback];
}

/**
 * Resolve model authentication for LLM calls.
 *
 * @param ctx - The extension command context.
 * @returns Auth info, or null after notifying the user on failure.
 */
async function resolveAuth(ctx: ExtensionCommandContext): Promise<AuthInfo | null> {
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
 * Create the /ask command handler.
 *
 * Flow: reformulate question → research engine → KB write-back → synthesis.
 *
 * @param pi - The pi extension API instance.
 * @returns The command handler function.
 */
export function createHandler(pi: ExtensionAPI) {
  return async (args: string, ctx: ExtensionCommandContext): Promise<void> => {
    const q = args.trim();
    if (!q) {
      ctx.ui.notify("Usage: /ask <question> — please provide a question.", "warning");
      return;
    }
    if (!ctx.model) {
      ctx.ui.notify("No model selected. Please select a model first (Ctrl+P).", "error");
      return;
    }
    ctx.ui.notify(`🔍 Researching: "${q.slice(0, 80)}…"`, "info");

    const auth = await resolveAuth(ctx);
    if (!auth) return;

    // Step 1: Reformulate into 1-3 research questions
    const reform = await runLlm<string[]>(
      ctx,
      "Reformulating questions...",
      REFORMULATION_PROMPT,
      `Question: ${q}`,
      (text) => parseQuestions(text, q),
    );
    if (!reform.ok && reform.type === "cancelled") {
      ctx.ui.notify("Research cancelled.", "info");
      return;
    }
    const questions = reform.ok ? reform.value : [q];

    // Step 2: Research engine (KB-first subagents) + Step 3: KB write-back
    const result: ResearchResult = await runResearchEngine(questions, ctx);
    const writeback = await writeBackToKB(result, {
      cwd: ctx.cwd,
      model: ctx.model,
      modelRegistry: ctx.modelRegistry,
    });

    // Step 4: Synthesize the answer from collected sources
    const sourcesStr = result.sources.map((s) => `- ${s.url}: ${s.snippet}`).join("\n");
    const synth = await runLlm<string>(
      ctx,
      "Synthesizing answer...",
      SYNTHESIS_PROMPT,
      `Question: ${q}\n\nSources:\n${sourcesStr || "(none)"}`,
      (text) => text.trim(),
    );
    const answer = synth.ok && synth.value ? synth.value : "_(synthesis unavailable)_";

    const wbLines = [
      ...writeback.created.map((p) => `created: ${p}`),
      ...writeback.updated.map((p) => `updated: ${p}`),
      ...writeback.skipped.map((s) => `skipped: ${s}`),
    ];
    pi.sendUserMessage(
      `## Answer: ${q}\n\n${answer}\n\n---\n` +
        `📄 Knowledge base (KNOWLEDGE_DIR):\n${wbLines.join("\n") || "(no changes)"}`,
    );
  };
}
