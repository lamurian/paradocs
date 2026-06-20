/**
 * Commands Extension — slash command entry point.
 *
 * Registers /ask, /research, and /summarize slash commands, each delegating
 * to its own handler module for modularity.
 *
 * Auto-discovered by `pi install` through the `extensions/` convention.
 *
 * @module extensions/commands/index
 */

import { handler as askHandler, description as askDescription } from "./ask.js";
import { handler as researchHandler, description as researchDescription } from "./research.js";
import { handler as summarizeHandler, description as summarizeDescription } from "./summarize.js";

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/**
 * Register all slash commands with the pi runtime.
 *
 * @param pi  The pi extension API instance.
 */
export default function (pi: ExtensionAPI): void {
  pi.registerCommand("ask", {
    description: askDescription,
    handler: askHandler,
  });

  pi.registerCommand("research", {
    description: researchDescription,
    handler: researchHandler,
  });

  pi.registerCommand("summarize", {
    description: summarizeDescription,
    handler: summarizeHandler,
  });
}
