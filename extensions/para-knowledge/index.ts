/**
 * PARA Knowledge Extension — modular refactor
 *
 * Orchestrator that imports and wires together all sub-modules.
 *
 * Module layout:
 *   index.ts        — Orchestrator (this file)
 *   types.ts        — Shared types and constants
 *   db.ts           — DuckDB connection management (open/close/withDb/recovery)
 *   schema.ts       — Table definitions (files, tags, term_index, doc_lengths, corpus_stats)
 *   frontmatter.ts  — YAML frontmatter parse/format
 *   files.ts        — Filesystem scanning (scanParaDir, parseFile, slugify)
 *   sync.ts         — Index syncing (filesystem → DuckDB, including BM25 term index)
 *   search.ts       — BM25 search engine (tokenize, bm25TermScore, searchDocuments)
 *   tools/          — Tool handlers
 *     searchDocs.ts — search_para_docs tool
 *     createDoc.ts  — create_para_doc tool
 *     updateDoc.ts  — update_para_doc tool
 *     listTags.ts   — list_para_tags tool
 *     findExistingSummary.ts — find_existing_summary tool
 *
 * Search pipeline (BM25):
 *   1. Tokenize query into individual meaningful words (stop words removed)
 *   2. **Batch-lookup** all terms in **one DuckDB query** using an IN-list
 *      (ART index on term_index.term is O(k) per term, k ≈ term length)
 *   3. Compute Okapi BM25 score per candidate document
 *   4. Add tag-match boost for overlapping tags
 *   5. Sort by combined score descending
 *
 * Optimisation: only 3 round-trips to DuckDB regardless of query length
 * (term+doc_lengths, tags, files-for-top-25). The old per-term loop was
 * O(terms) round-trips; now it's O(1).
 *
 * Tools:
 *   search_para_docs   — BM25-powered search by text + tags
 *   create_para_doc    — create markdown file + index it
 *   update_para_doc    — update markdown file + re-index it
 *   list_para_tags     — list all unique tags across all indexed documents
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerSearchDocsTool } from "./tools/searchDocs.js";
import { registerCreateDocTool } from "./tools/createDoc.js";
import { registerUpdateDocTool } from "./tools/updateDoc.js";
import { registerListTagsTool } from "./tools/listTags.js";
import { registerFindExistingSummaryTool } from "./tools/findExistingSummary.js";
import { registerResolveCitationTool } from "./tools/resolveCitation.js";

/**
 * Extension entry point.
 * Called once by pi on load. Registers all six tools.
 */
export default function (pi: ExtensionAPI): void {
  registerSearchDocsTool(pi);
  registerCreateDocTool(pi);
  registerUpdateDocTool(pi);
  registerListTagsTool(pi);
  registerFindExistingSummaryTool(pi);
  registerResolveCitationTool(pi);
}
