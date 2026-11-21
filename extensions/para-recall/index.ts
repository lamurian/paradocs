/**
 * PARA recall extension.
 *
 * Injects a hidden, deterministic BM25 recall block before the agent starts.
 * The lookup only reads an existing notes.db; it never creates or rebuilds
 * the index and never calls an LLM.
 *
 * @module extensions/para-recall
 */

import { loadParadocsConfig } from "../../common/config.ts";
import { getKnowledgeConfig } from "../../common/env.ts";
import { openNotesDbReadOnly } from "../../common/notesDb.ts";
import { runRecall } from "../../common/recall.ts";

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/**
 * Register the before_agent_start recall hook.
 *
 * Missing notes.db produces no injection. Results slower than
 * `recall.timeoutMs` are discarded because SQLite is synchronous and the
 * block would otherwise arrive too late.
 *
 * @param pi - The pi extension API.
 */
export default function (pi: ExtensionAPI): void {
  pi.on("before_agent_start", (event, ctx) => {
    const db = openNotesDbReadOnly(ctx.cwd);
    if (!db) return;

    const knowledgeDir = getKnowledgeConfig(ctx.cwd).dir;
    const { config } = loadParadocsConfig(knowledgeDir);

    const startedAt = performance.now();
    const result = runRecall(event.prompt, db, config, new Date());
    const elapsed = performance.now() - startedAt;

    if (elapsed > config.recall.timeoutMs) return;
    if (!result) return;

    return {
      message: {
        customType: "paradocs-recall",
        content: result.block,
        display: false,
      },
    };
  });
}
