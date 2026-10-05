/**
 * Knowledge base write-back — routes research results into PARA notes.
 *
 * Resolves citations for each unique source URL, groups sources into
 * atomic notes via one subagent call (GROUPING_PROMPT, retried once),
 * then routes: outdated notes → read/merge/reindex under KNOWLEDGE_DIR,
 * new notes → batch-create path (atomicity + citation validation, create,
 * index, auto-link). When grouping fails after the retry, a draft note
 * with sources + citekeys + synthesis is dumped to
 * KNOWLEDGE_DIR/.research/drafts/<jobId>.md — research is never discarded.
 *
 * @module extensions/research-engine/writeback
 */

import { writeDraftNote } from "./draft.js";
import { toSubagentModel } from "./types.js";
import { resolveAllCitations, updateExistingNote, createNewNotes } from "./writeback-helpers.js";
import { configureEnv, getKnowledgeConfig } from "../../common/env.js";
import { extractJson } from "../../common/extractJson.js";
import { ensureNotesDb } from "../../common/notesDb.js";
import { buildSubagentArgs, resolveSubagentTimeoutMs, runSubagent } from "../../common/subagent.js";
import { searchDocs } from "../para-knowledge/db-sqlite.js";

import type { ResearchResult, WritebackResult } from "./types.js";
import type { GroupedNote, GroupedOutdated } from "./writeback-helpers.js";

/** Minimal context surface the write-back needs from commands or tools. */
export interface WritebackContext {
  /** Working directory for env config resolution. */
  cwd: string;
  /** Runtime model (atomicity subagent) + provider/modelId for grouping. */
  model: import("./types.js").RuntimeModel;
  /** Parent abort signal (pipeline cancellation). */
  signal?: AbortSignal;
  /**
   * Injectable grouping call for tests. Defaults to the grouping
   * subagent (GROUPING_PROMPT, --no-tools, 120s timeout).
   */
  groupingFn?: (input: {
    system: string;
    user: string;
    timeoutMs?: number;
    signal?: AbortSignal;
  }) => Promise<{ ok: boolean; value?: GroupingResult; error?: string }>;
}

/** Parsed shape of the grouping LLM response. */
export interface GroupingResult {
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
 * Parse and validate the grouping LLM response (lenient).
 *
 * Missing \`outdated\` arrays default to [] (models omit empty arrays);
 * missing or non-array \`notes\` yields null.
 *
 * @param text - Raw LLM response text.
 * @returns Parsed grouping result, or null when the shape is invalid.
 */
export function parseGrouping(text: string): GroupingResult | null {
  const parsed = extractJson(text);
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const obj = parsed as Partial<GroupingResult>;
  if (!Array.isArray(obj.notes)) return null;
  return {
    notes: obj.notes,
    outdated: Array.isArray(obj.outdated) ? obj.outdated : [],
  };
}

/** Default grouping call: one lean subagent with GROUPING_PROMPT. */
function subagentGrouping(ctx: WritebackContext): NonNullable<WritebackContext["groupingFn"]> {
  return async (input) => {
    const sub = toSubagentModel(ctx.model);
    const args = buildSubagentArgs({
      provider: sub.provider,
      modelId: sub.modelId,
      systemPrompt: input.system,
      task: input.user,
      extraArgs: ["--no-tools"],
    });
    const res = await runSubagent<GroupingResult>({
      args,
      cwd: ctx.cwd,
      timeoutMs: input.timeoutMs ?? resolveSubagentTimeoutMs("grouping"),
      signal: input.signal ?? ctx.signal,
      parse: parseGrouping,
    });
    if (res.ok) return { ok: true, value: res.value ?? undefined };
    return { ok: false, error: res.error };
  };
}

/**
 * Write research results back to the knowledge base.
 *
 * @param result - Merged research results (sources carry citation
 *                 metadata; jobId/synthesis feed the draft fallback).
 * @param ctx - Context providing cwd, model, optional grouping override.
 * @returns Paths created/updated and a list of skipped items.
 */
export async function writeBackToKB(
  result: ResearchResult & { jobId?: string; synthesis?: string },
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

  // 2. KB context for the grouping prompt (deterministic search)
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

  // 3. One subagent call: group sources into notes + detect outdated notes.
  //    Retry once on failure; on final failure dump a draft note.
  const grouping = ctx.groupingFn ?? subagentGrouping(ctx);
  const input = {
    system: GROUPING_PROMPT,
    user: `Research sources:\n${sourcesStr}\n\nExisting KB docs:\n${kbCtx}`,
    timeoutMs: resolveSubagentTimeoutMs("grouping"),
    signal: ctx.signal,
  };
  let result1 = await grouping(input);
  if (!result1.ok || !result1.value) result1 = await grouping(input);
  const grouped = result1;

  if (!grouped.ok || !grouped.value) {
    const reason = grouped.ok ? "invalid grouping response" : (grouped.error ?? "grouping failed");
    skipped.push(`write-back skipped: grouping failed: ${reason}`);
    try {
      const path = writeDraftNote(knowledgeDir, {
        jobId: result.jobId ?? "unknown-job",
        question: result.questions[0],
        sources: result.sources,
        citekeys: citations.citekeys,
        synthesis: result.synthesis,
      });
      skipped.push(`draft: ${path}`);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      skipped.push(`draft failed: ${msg.slice(0, 200)}`);
    }
    return { created, updated, skipped };
  }

  // 4. Update outdated notes
  for (const note of grouped.value.outdated) {
    try {
      await updateExistingNote(note, knowledgeDir, ctx.cwd);
      updated.push(note.path);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      skipped.push(`update failed: ${note.path} (${msg.slice(0, 80)})`);
    }
  }

  // 5. Create new notes via the batch-create path
  const batch = await createNewNotes(grouped.value.notes, ctx.model, db, knowledgeDir, ctx.cwd);
  created.push(...batch.created);
  skipped.push(...batch.skipped);

  return { created, updated, skipped };
}
