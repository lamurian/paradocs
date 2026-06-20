/**
 * /summarize command — stub handler for URL summarization workflow.
 *
 * Fetches a URL, checks for existing summaries, extracts content (HTML via
 * Obscura, PDF via pdftotext), summarises it, and creates a PARA document.
 *
 * @module extensions/commands/summarize
 */

import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

/** Human-readable description shown in /commands list */
export const description = "Summarise a URL into a knowledge document";

/**
 * Handle the /summarize command.
 *
 * @param args  Raw argument string from the user (the URL).
 * @param ctx   Extension command context for UI interactions.
 */
export async function handler(args: string, ctx: ExtensionCommandContext): Promise<void> {
  const url = args.trim();

  if (!url) {
    ctx.ui.notify("Usage: /summarize <url> — please provide a URL.", "warning");
    return;
  }

  try {
    ctx.ui.notify(`📄 Summarising: "${url.slice(0, 80)}…"`, "info");

    // TODO: Implement summarise skill workflow
    // 1. find_existing_summary for dedup check
    // 2. fetch_url / Obscura extraction
    // 3. LLM summarisation
    // 4. resolve_citation for BibTeX
    // 5. create_para_doc with summary content

    await Promise.resolve();

    ctx.ui.notify(`✅ Stub: /summarize handled. URL was: "${url.slice(0, 60)}…"`, "info");
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    ctx.ui.notify(`❌ /summarize error: ${msg}`, "error");
  }
}
