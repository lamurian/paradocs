/**
 * /ask command — deterministic research pipeline (FSM orchestrator).
 *
 * Validates input, then runs the research orchestrator. In TUI mode the
 * handler blocks with per-stage working-message progress; in rpc/json/print
 * modes it returns immediately (never blocking the prompt ack) and delivers
 * the answer via pi.sendUserMessage once the pipeline reaches a terminal
 * state.
 *
 * @module extensions/commands/ask
 */

import { configureEnv } from "../../common/env.js";
import { buildResearchDeps } from "../research-engine/deps.js";
import { DEFAULT_STAGE_MESSAGES, runResearch } from "../research-engine/orchestrator.js";
import { ASK_DEEP_PROFILE } from "../research-engine/profiles.js";

import type { ResearchAuth } from "../research-engine/deps.js";
import type { ResearchState, ResearchStage } from "../research-engine/state.js";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

/** Command description shown in /commands. */
export const description = "Ask a question and get a researched answer with KB write-back";

/**
 * Render the delivered answer message (answer + write-back status).
 *
 * @param question - The original question.
 * @param state - Terminal research state.
 * @returns Message body for pi.sendUserMessage.
 */
export function renderAskAnswer(question: string, state: ResearchState): string {
  const answer =
    state.synthesis && state.synthesis.trim().length > 0
      ? state.synthesis
      : `_(synthesis unavailable: ${state.synthesisError ?? "no sources collected"})_`;
  const wb = state.writeback;
  const wbLines = wb
    ? [
        ...wb.created.map((p) => `created: ${p}`),
        ...wb.updated.map((p) => `updated: ${p}`),
        ...wb.skipped.map((s) => `skipped: ${s}`),
      ]
    : ["(write-back not run)"];
  return (
    `## Answer: ${question}\n\n${answer}\n\n---\n` +
    `📄 Knowledge base (KNOWLEDGE_DIR):\n${wbLines.join("\n") || "(no changes)"}`
  );
}

/**
 * Resolve model auth for the pipeline.
 *
 * @param ctx - Command context.
 * @returns Auth info, or null after notifying the user on failure.
 */
async function resolveAuth(ctx: ExtensionCommandContext): Promise<ResearchAuth | null> {
  if (!ctx.model) return null;
  const model = ctx.model as ResearchAuth["model"];
  try {
    const result = await ctx.modelRegistry.getApiKeyAndHeaders(model);
    if (!result.ok || !result.apiKey) {
      ctx.ui.notify(`❌ No API key for ${model.provider}`, "error");
      return null;
    }
    return { model, apiKey: result.apiKey, headers: result.headers };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    ctx.ui.notify(`❌ Auth error: ${msg}`, "error");
    return null;
  }
}

/** Generate a unique research job id. */
function newJobId(): string {
  return `ask-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Create the /ask command handler.
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
    configureEnv(ctx.cwd);

    const deps = buildResearchDeps(ctx, auth, {});
    if (ctx.mode === "tui") {
      deps.onProgress = (_stage: ResearchStage, message: string) => {
        ctx.ui.setWorkingVisible(true);
        ctx.ui.setWorkingMessage(message);
      };
    }

    const run = runResearch(deps, {
      question: q,
      mode: "breadth",
      profile: ASK_DEEP_PROFILE,
      jobId: newJobId(),
    });

    if (ctx.mode === "tui") {
      ctx.ui.setWorkingVisible(true);
      try {
        const state = await run;
        ctx.ui.setWorkingMessage(DEFAULT_STAGE_MESSAGES[state.stage]);
        pi.sendUserMessage(renderAskAnswer(q, state));
      } finally {
        ctx.ui.setWorkingVisible(false);
        ctx.ui.setWorkingMessage(undefined);
      }
      return;
    }

    // rpc/json/print: never block the prompt ack — deliver in the background.
    void run
      .then((state) => {
        pi.sendUserMessage(renderAskAnswer(q, state));
      })
      .catch((e: unknown) => {
        const msg = e instanceof Error ? e.message : String(e);
        ctx.ui.notify(`❌ Research failed: ${msg.slice(0, 200)}`, "error");
      });
  };
}
