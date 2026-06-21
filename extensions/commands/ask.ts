/**
 * /ask command — handler and TUI integration.
 *
 * Orchestration logic lives in ask-orchestrator.ts.
 *
 * @module extensions/commands/ask
 */

import { complete } from "@earendil-works/pi-ai";
import { BorderedLoader } from "@earendil-works/pi-coding-agent";

import { executeResearchLoop } from "./ask-orchestrator.js";

import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

// ── Constants ───────────────────────────────────────────────────────

/** Human-readable description shown in /commands list */
export const description = "Ask a question and get a knowledge document answer";

// ── Formatting ──────────────────────────────────────────────────────

/**
 * Format the final conversation message with answer and document reference.
 */
export function formatFinalMessage(
  question: string,
  synthesis: string,
  docPath: string | null,
): string {
  const lines = [`## Answer: ${question}`, "", synthesis];
  if (docPath) {
    const trimmed = question.length > 60 ? question.slice(0, 60) + "…" : question;
    lines.push("", `---`, `📝 Atomic note created at \`${docPath}\``);
    lines.push(`**Summary**: Research synthesis on "${trimmed}"`);
  }
  return lines.join("\n");
}

// ── Handler ─────────────────────────────────────────────────────────

/**
 * Create the /ask command handler.
 *
 * @param pi  The pi extension API instance.
 * @returns   The command handler function.
 */
export function createHandler(pi: ExtensionAPI) {
  return async (args: string, ctx: ExtensionCommandContext): Promise<void> => {
    const question = args.trim();

    if (!question) {
      ctx.ui.notify("Usage: /ask <question> — please provide a question.", "warning");
      return;
    }

    if (typeof ctx.ui.custom !== "function") {
      ctx.ui.notify("/ask requires interactive (TUI) mode.", "error");
      return;
    }

    if (!ctx.model) {
      ctx.ui.notify("No model selected. Please select a model first (Ctrl+P).", "error");
      return;
    }

    try {
      ctx.ui.notify(`🔍 Researching: "${question.slice(0, 80)}…"`, "info");

      const model = ctx.model as Parameters<typeof complete>[0];

      const result = await ctx.ui.custom<{
        synthesis: string;
        docPath: string | null;
      } | null>((tui, theme, _kb, done) => {
        const loader = new BorderedLoader(tui, theme, "Searching Sources...");
        loader.onAbort = () => done(null);

        const run = async () => {
          try {
            const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
            if (!auth.ok || !auth.apiKey) {
              ctx.ui.notify("Failed to get API key for model.", "error");
              done(null);
              return;
            }
            const llmOpts = {
              model,
              apiKey: auth.apiKey,
              headers: auth.headers,
              signal: loader.signal,
            };

            const { synthesis, docPath } = await executeResearchLoop(
              question,
              llmOpts,
              ctx.cwd,
              (msg: string) => ctx.ui.notify(msg, "info"),
            );
            done({ synthesis, docPath });
          } catch (err) {
            console.error("[ask] Orchestration error:", err);
            ctx.ui.notify(
              `❌ Research error: ${err instanceof Error ? err.message : String(err)}`,
              "error",
            );
            done(null);
          }
        };

        void run();
        return loader;
      });

      if (result) {
        pi.sendUserMessage(formatFinalMessage(question, result.synthesis, result.docPath));
      }

      await Promise.resolve();
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      ctx.ui.notify(`❌ /ask error: ${msg}`, "error");
    }
  };
}
