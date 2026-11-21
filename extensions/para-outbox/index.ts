/**
 * PARA Outbox Extension — stage_para_docs write path.
 *
 * Registers the staging tool, which validates block-structured notes and
 * writes them to `<cwd>/.pi/paradocs/outbox/<batchId>/`. Safe in read-only
 * processes because it never touches KNOWLEDGE_DIR, notes.db or ref.bib.
 *
 * @module extensions/para-outbox
 */

import { registerIngestTool } from "./ingest-tool.ts";
import { registerStageTool } from "./stage-tool.ts";

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/**
 * Extension entry point.
 *
 * @param pi - The pi extension API.
 */
export default function (pi: ExtensionAPI): void {
  registerStageTool(pi);

  // Minimal test doubles only provide registerTool; the real pi API also
  // exposes commands and the shared event bus needed by the ingest path.
  const hasCommands = typeof pi.registerCommand === "function";
  const hasEvents = typeof pi.events?.on === "function";
  if (hasCommands || hasEvents) {
    registerIngestTool(pi);
  }
}
