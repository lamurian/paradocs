/**
 * /ask command — stub handler for knowledge Q&A workflow.
 *
 * Delegates to the knowledge skill: searches PARA docs, clarifies via
 * brainstorm if needed, searches the web, and creates new documents.
 *
 * @module extensions/commands/ask
 */

import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

/** Human-readable description shown in /commands list */
export const description = "Ask a question and get a knowledge document answer";

/**
 * Handle the /ask command.
 *
 * @param args  Raw argument string from the user (the question).
 * @param ctx   Extension command context for UI interactions.
 */
export async function handler(args: string, ctx: ExtensionCommandContext): Promise<void> {
  const question = args.trim();

  if (!question) {
    ctx.ui.notify("Usage: /ask <question> — please provide a question.", "warning");
    return;
  }

  try {
    ctx.ui.notify(`🔍 Researching: "${question.slice(0, 80)}…"`, "info");

    // TODO: Implement knowledge skill workflow
    // 1. search_para_docs for existing knowledge
    // 2. If no match, brainstorm via brainstorm skill
    // 3. web_search for supplementary info
    // 4. create_para_doc with synthesized answer

    await Promise.resolve();

    ctx.ui.notify(`✅ Stub: /ask handled. Question was: "${question.slice(0, 60)}…"`, "info");
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    ctx.ui.notify(`❌ /ask error: ${msg}`, "error");
  }
}
