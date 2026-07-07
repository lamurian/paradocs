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

import { createHandler as createAskHandler, description as askDescription } from "./ask.js";
import {
  createHandler as createResearchHandler,
  description as researchDescription,
} from "./research.js";
import {
  createHandler as createSummarizeHandler,
  description as summarizeDescription,
} from "./summarize.js";
import { registerAskTool } from "./tools/ask.js";

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/**
 * Register all slash commands and tools with the pi runtime.
 *
 * @param pi  The pi extension API instance.
 */
export default function (pi: ExtensionAPI): void {
  pi.registerCommand("ask", {
    description: askDescription,
    handler: createAskHandler(pi),
  });

  pi.registerCommand("research", {
    description: researchDescription,
    handler: createResearchHandler(pi),
  });

  pi.registerCommand("summarize", {
    description: summarizeDescription,
    handler: createSummarizeHandler(pi),
  });

  registerAskTool(pi);
}
