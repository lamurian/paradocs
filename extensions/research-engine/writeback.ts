/**
 * Knowledge base write-back — routes research results into PARA notes.
 *
 * Resolves citations for each unique source URL, uses one LLM call to group
 * sources into atomic notes and detect outdated existing notes, then routes:
 * outdated notes → read/merge/reindex under KNOWLEDGE_DIR, new notes →
 * batch-create path (atomicity + citation validation, create, index, auto-link).
 *
 * @module extensions/research-engine/writeback
 */

import { resolveAllCitations, updateExistingNote, createNewNotes } from "./writeback-helpers.js";
import { configureEnv, getKnowledgeConfig } from "../../common/env.js";
import { extractJson } from "../../common/extractJson.js";
import { callLlmDirect } from "../../common/llm.js";
import { ensureNotesDb } from "../../common/notesDb.js";
import { searchDocs } from "../para-knowledge/db-sqlite.js";

import type { ResearchResult, WritebackResult } from "./types.js";
import type { GroupedNote, GroupedOutdated } from "./writeback-helpers.js";
import type { Api, Model } from "@earendil-works/pi-ai";

/** Minimal context surface the write-back needs from commands or tools. */
export interface WritebackContext {
  /** Working directory for env config resolution. */
  cwd: string;
  /** Active model for the grouping LLM call. */
  model?: Model<Api>;
  /** Model registry for API key resolution. */
  modelRegistry?: {
    getApiKeyAndHeaders: (
      model: Model<Api>,
    ) => Promise<{ ok: boolean; apiKey?: string; headers?: Record<string, string> }>;
  };
}

/** Parsed shape of the grouping LLM response. */
interface GroupingResult {
  notes: GroupedNote[];
  outdated: GroupedOutdated[];
}

/** System prompt instructing the LLM to group sources and detect outdated notes. */
export const GROUPING_PROMPT = `You group research sources into atomic knowledge base notes and detect outdated existing notes.

Return ONLY valid JSON. No markdown fences, no explanatory text.
{
  "notes": [{"title": "...", "content": "...", "tags": ["..."], "area": "Resources", "source": "url"}],
  "outdated": [{"path": "Resources/foo.md", "reason": "...", "content": "refreshed markdown body"}]
}

Rules:
- Each note covers exactly one key idea (atomic principle). Recommended body: ## Summary, ## Key Points, ## Sources.
- Cite sources in note content using @citekey notation from the resolved citations list.
- area is one of "Resources", "Areas", "Projects" (default "Resources").
- Mark an existing note outdated ONLY when the new sources supersede it; provide the refreshed markdown body in "content".
- Keep tags short and reusable.`;

/**
 * Parse and validate the grouping LLM response.
 *
 * @param text - Raw LLM response text.
 * @returns Parsed grouping result, or null when the shape is invalid.
 */
export function parseGrouping(text: string): GroupingResult | null {
  const parsed = extractJson(text);
  if (parsed === null || typeof parsed !== "object") return null;
  const obj = parsed as Partial<GroupingResult>;
  if (!Array.isArray(obj.notes) || !Array.isArray(obj.outdated)) return null;
  return { notes: obj.notes, outdated: obj.outdated };
}

/**
 * Write research results back to the knowledge base.
 *
 * @param result - Merged research result (sources may carry citation
 *                 metadata: title/authors/year).
 * @param ctx - Context providing cwd, model, and modelRegistry.
 * @returns Paths created/updated and a list of skipped items.
 */
export async function writeBackToKB(
  result: ResearchResult,
  ctx: WritebackContext,
): Promise<WritebackResult> {
  configureEnv(ctx.cwd);
  const { dir: knowledgeDir } = getKnowledgeConfig(ctx.cwd);
  const created: string[] = [];
  const updated: string[] = [];
  const skipped: string[] = [];

  // 1. Resolve citations once per unique URL
  const citations = await resolveAllCitations(result.sources, ctx.cwd);
  skipped.push(...citations.skipped);

  // 2. Resolve auth for the grouping LLM call
  if (!ctx.model || !ctx.modelRegistry) {
    skipped.push("write-back skipped: no model selected");
    return { created, updated, skipped };
  }
  const auth = await ctx.modelRegistry.getApiKeyAndHeaders(ctx.model);
  if (!auth.ok || !auth.apiKey) {
    skipped.push("write-back skipped: no API key for model provider");
    return { created, updated, skipped };
  }

  // 3. One LLM call: group sources into notes + detect outdated notes
  const db = await ensureNotesDb(ctx.cwd);
  const kbDocs = searchDocs(db, result.questions.join(" "), {}, 10);
  const kbCtx =
    kbDocs.length === 0
      ? "No existing documents found."
      : kbDocs
          .map(
            (d) =>
              `- **${d.title}** (\`${d.path}\`)${d.created ? ` (date: ${d.created.slice(0, 10)})` : ""}: ${d.body.slice(0, 300)}`,
          )
          .join("\n");
  const sourcesStr = result.sources
    .map(
      (s) =>
        `- ${s.url}${s.title ? ` (${s.title})` : ""} (@${citations.citekeys.get(s.url) ?? "unresolved"}): ${s.snippet}`,
    )
    .join("\n");

  const grouping = await callLlmDirect<GroupingResult>(
    ctx.model,
    { apiKey: auth.apiKey, headers: auth.headers },
    GROUPING_PROMPT,
    [
      {
        type: "text",
        text: `Research sources:\n${sourcesStr}\n\nExisting KB docs:\n${kbCtx}`,
      },
    ],
    parseGrouping,
  );
  if (!grouping.ok || !grouping.value) {
    const reason = grouping.ok
      ? "invalid LLM response shape"
      : grouping.type === "error"
        ? grouping.message
        : "cancelled";
    skipped.push(`write-back skipped: grouping LLM call failed: ${reason}`);
    return { created, updated, skipped };
  }

  // 4. Update outdated notes
  for (const note of grouping.value.outdated) {
    try {
      await updateExistingNote(note, knowledgeDir, ctx.cwd);
      updated.push(note.path);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      skipped.push(`update failed: ${note.path} (${msg.slice(0, 80)})`);
    }
  }

  // 5. Create new notes via the batch-create path
  const batch = await createNewNotes(grouping.value.notes, ctx.model, db, knowledgeDir, ctx.cwd);
  created.push(...batch.created);
  skipped.push(...batch.skipped);

  return { created, updated, skipped };
}
