/**
 * PARA Knowledge Extension — read-only knowledge tools.
 *
 * Orchestrator that imports and wires together the read-only sub-modules.
 *
 * Module layout:
 *   index.ts        — Orchestrator (this file)
 *   types.ts        — Shared types and constants
 *   db-sqlite.ts    — SQLite connection, schema and FTS5 search
 *   files.ts        — Filesystem scanning (scanParaDir, parseFile, slugify)
 *   frontmatter.ts  — YAML frontmatter parse/format
 *   similarity.ts   — Text similarity helpers for later reuse
 *   sqlite-init.ts / sqlite-indexing.ts / sqlite-search.ts / sqlite-types.ts
 *   tools/          — Tool handlers
 *     searchDocs.ts      — search_para_docs tool
 *     listTags.ts        — list_para_tags tool
 *     resolveCitation.ts — resolve_citation tool (preview only, never writes)
 *
 * Search pipeline (FTS5 BM25):
 *   1. Tokenize query into individual meaningful words (stop words removed)
 *   2. Look terms up in the FTS5 index
 *   3. Compute Okapi BM25 score per candidate document
 *   4. Add tag-match boost for overlapping tags
 *   5. Sort by combined score descending
 *
 * Tools:
 *   search_para_docs   — BM25-powered search by text + tags
 *   list_para_tags     — list all unique tags across all indexed documents
 *   resolve_citation   — resolve a DOI/URL citation (preview only)
 */

import { reindexChanged } from "./reindex.ts";
import { registerListTagsTool } from "./tools/listTags.ts";
import { registerResolveCitationTool } from "./tools/resolveCitation.ts";
import { registerSearchDocsTool } from "./tools/searchDocs.ts";
import { getKnowledgeConfig } from "../../common/env.ts";
import { ensureNotesDb } from "../../common/notesDb.ts";
import { isReadOnlyProcess } from "../../common/runtime.ts";

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/**
 * Extension entry point.
 * Called once by pi on load. Registers the read-only knowledge tools.
 *
 * @param pi - The pi extension API.
 */
export default function (pi: ExtensionAPI): void {
  registerSearchDocsTool(pi);
  registerListTagsTool(pi);
  registerResolveCitationTool(pi);

  pi.on("session_start", async (_event, ctx) => {
    if (isReadOnlyProcess()) return;

    try {
      const db = await ensureNotesDb(ctx.cwd);
      const knowledgeDir = getKnowledgeConfig(ctx.cwd).dir;
      await reindexChanged(db, knowledgeDir);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(`[para-knowledge] session_start reindex failed: ${msg}`);
    }
  });
}
