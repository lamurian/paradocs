/**
 * /research command — stub handler for iterative academic research workflow.
 *
 * Decomposes a topic via WHY/HOW decomposition, gathers evidence through
 * tiered academic web search, and synthesises results into linked atomic notes.
 *
 * @module extensions/commands/research
 */

import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

/** Human-readable description shown in /commands list */
export const description = "Run iterative academic research on a topic";

/**
 * Handle the /research command.
 *
 * @param args  Raw argument string from the user (the topic).
 * @param ctx   Extension command context for UI interactions.
 */
export async function handler(args: string, ctx: ExtensionCommandContext): Promise<void> {
  const topic = args.trim();

  if (!topic) {
    ctx.ui.notify("Usage: /research <topic> — please provide a research topic.", "warning");
    return;
  }

  try {
    ctx.ui.notify(`🔬 Researching: "${topic.slice(0, 80)}…"`, "info");

    // TODO: Implement research skill workflow
    // 1. WHY/HOW decomposition of the topic
    // 2. Hypothesis-driven tier-1 academic web search
    // 3. Evidence gathering and synthesis
    // 4. Create linked atomic notes via create_para_doc

    await Promise.resolve();

    ctx.ui.notify(`✅ Stub: /research handled. Topic was: "${topic.slice(0, 60)}…"`, "info");
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    ctx.ui.notify(`❌ /research error: ${msg}`, "error");
  }
}
