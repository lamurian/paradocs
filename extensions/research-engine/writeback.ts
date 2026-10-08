/**
 * Knowledge base write-back — routes research results into PARA notes.
 *
 * Decomposed into plan -> concurrent fills -> route: (1) a tiny structured
 * plan call (PLAN_PROMPT, thinking medium, grouping budget) maps sources +
 * citekeys + KB context to per-note entries {title, tags, area, source
 * urls, key idea}; (2) per-note fill calls run concurrently (limit 4,
 * thinking medium, 60s each) produce one markdown body each; (3) the
 * assembled GroupingResult feeds the unchanged routing step: outdated
 * notes -> read/merge/reindex under KNOWLEDGE_DIR, new notes ->
 * batch-create path. Degradation: a failed fill drops only that note with
 * a 'note skipped: {title} ({error})' line; a failed plan call triggers
 * exactly one corrective retry quoting the bad output (surfaced via
 * ctx.onProgress), then a draft note with sources + citekeys + synthesis
 * is dumped to KNOWLEDGE_DIR/.research/drafts/<jobId>.md — research is
 * never discarded.
 *
 * @module extensions/research-engine/writeback
 */

import { toSubagentModel } from "./types.js";
import { assembleFills, draftFallbackLines, unplannedSourceLines } from "./writeback-assembly.js";
import { resolveAllCitations, updateExistingNote, createNewNotes } from "./writeback-helpers.js";
import {
  PLAN_PROMPT,
  FILL_PROMPT,
  buildKbContext,
  buildSourcesStr,
  mapEntrySources,
  fillUser,
  parsePlan,
  planFailureReason,
  planWithRetry,
} from "./writeback-plan.js";
import { configureEnv, getKnowledgeConfig } from "../../common/env.js";
import { ensureNotesDb } from "../../common/notesDb.js";
import { buildSubagentArgs, resolveSubagentTimeoutMs, runSubagent } from "../../common/subagent.js";
import { searchDocs } from "../para-knowledge/db-sqlite.js";

import type { ResearchResult, RuntimeModel, WritebackResult } from "./types.js";
import type { GroupedNote, GroupedOutdated } from "./writeback-helpers.js";
import type { PlanResult, WritebackCallInput, WritebackCallResult } from "./writeback-plan.js";

/** Max concurrent per-note fill subagent calls. */
const FILL_CONCURRENCY = 4;
/** Per-note fill subagent budget (ms): one markdown body. */
const FILL_TIMEOUT_MS = 60_000;

/** Assembled grouping result feeding the unchanged routing step. */
export interface GroupingResult {
  notes: GroupedNote[];
  outdated: GroupedOutdated[];
}

/** Minimal context surface the write-back needs from commands or tools. */
export interface WritebackContext {
  /** Working directory for env config resolution. */
  cwd: string;
  /** Runtime model (atomicity subagent) + provider/modelId for plan/fill. */
  model: RuntimeModel;
  /** Parent abort signal (pipeline cancellation). */
  signal?: AbortSignal;
  /** Progress messages surfaced to the caller (e.g. onDetail -> status bar). */
  onProgress?: (message: string) => void;
  /** Injectable plan call for tests. Defaults to the plan subagent. */
  planFn?: (input: WritebackCallInput) => Promise<WritebackCallResult<PlanResult>>;
  /** Injectable per-note fill call for tests. Defaults to the fill subagent. */
  fillFn?: (input: WritebackCallInput) => Promise<WritebackCallResult<string>>;
}

/** Run one lean write-back subagent call (plan or fill), never throws. */
async function runWritebackCall<T>(
  ctx: WritebackContext,
  input: WritebackCallInput,
  timeoutMs: number,
  parse?: (text: string) => T | null,
): Promise<WritebackCallResult<T>> {
  const sub = toSubagentModel(ctx.model);
  const args = buildSubagentArgs({
    provider: sub.provider,
    modelId: sub.modelId,
    systemPrompt: input.system,
    task: input.user,
    extraArgs: ["--no-tools"],
    thinking: "medium",
  });
  const res = await runSubagent<T>({
    args,
    cwd: ctx.cwd,
    timeoutMs,
    signal: input.signal ?? ctx.signal,
    parse,
  });
  if (res.ok) return { ok: true, value: res.value ?? undefined };
  return { ok: false, error: res.error };
}

/** Default plan call: one lean subagent mapping sources to tiny entries. */
function subagentPlan(ctx: WritebackContext): NonNullable<WritebackContext["planFn"]> {
  return (input) =>
    runWritebackCall<PlanResult>(
      ctx,
      input,
      input.timeoutMs ?? resolveSubagentTimeoutMs("grouping"),
      parsePlan,
    );
}

/** Default fill call: one lean subagent producing a single note body. */
function subagentFill(ctx: WritebackContext): NonNullable<WritebackContext["fillFn"]> {
  return (input) => runWritebackCall<string>(ctx, input, input.timeoutMs ?? FILL_TIMEOUT_MS);
}

/**
 * Map items with bounded concurrency, preserving result order.
 *
 * @param items - Items to map.
 * @param limit - Max concurrent fn invocations.
 * @param fn - Async mapper for one item.
 * @returns Results in input order.
 */
async function mapWithLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/** Compose a '<label>: <detail> (<error>)' skip line from a caught error. */
function errLine(label: string, detail: string, e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  return `${label}: ${detail} (${msg.slice(0, 80)})`;
}

/**
 * Write research results back to the knowledge base.
 *
 * @param result - Merged research results (sources carry citation
 *                 metadata; jobId/synthesis feed the draft fallback).
 * @param ctx - Context providing cwd, model, optional plan/fill overrides
 *              and an onProgress channel for retry/skip notices.
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

  // 2. KB context for the plan prompt (deterministic search)
  const db = await ensureNotesDb(ctx.cwd);
  const kbCtx = buildKbContext(searchDocs(db, result.questions.join(" "), {}, 10));
  const sourcesStr = buildSourcesStr(result.sources, citations.citekeys);

  // 3. Plan call with exactly one corrective retry, then the draft fallback.
  const plan = ctx.planFn ?? subagentPlan(ctx);
  const planned = await planWithRetry(
    plan,
    {
      system: PLAN_PROMPT,
      user: `Research sources:\n${sourcesStr}\n\nExisting KB docs:\n${kbCtx}`,
      timeoutMs: resolveSubagentTimeoutMs("grouping"),
      signal: ctx.signal,
    },
    ctx.onProgress,
  );
  if (!planned.ok || !planned.value) {
    skipped.push(`write-back skipped: grouping failed: ${planFailureReason(planned)}`);
    skipped.push(...draftFallbackLines(knowledgeDir, result, citations.citekeys));
    return { created, updated, skipped };
  }

  // 4. Surface sources the plan never referenced (never discard silently).
  skipped.push(...unplannedSourceLines(result.sources, planned.value.plan, ctx.onProgress));

  // 5. Concurrent per-note fills (limit 4); a failed fill drops only that note.
  const fill = ctx.fillFn ?? subagentFill(ctx);
  const mapped = planned.value.plan.map((entry) => ({
    entry,
    lines: mapEntrySources(entry, result.sources, citations.citekeys),
  }));
  const fills = await mapWithLimit(mapped, FILL_CONCURRENCY, async ({ entry, lines }) => {
    const res = await fill({
      system: FILL_PROMPT,
      user: fillUser(entry, lines),
      timeoutMs: FILL_TIMEOUT_MS,
      signal: ctx.signal,
    });
    return { entry, res };
  });
  const { notes, skipped: fillSkips } = assembleFills(fills);
  for (const line of fillSkips) ctx.onProgress?.(line);
  skipped.push(...fillSkips);
  const grouped: GroupingResult = { notes, outdated: planned.value.outdated };

  // 6. Update outdated notes
  for (const note of grouped.outdated) {
    try {
      await updateExistingNote(note, knowledgeDir, ctx.cwd);
      updated.push(note.path);
    } catch (e: unknown) {
      skipped.push(errLine("update failed", note.path, e));
    }
  }

  // 7. Create new notes via the batch-create path
  const batch = await createNewNotes(grouped.notes, ctx.model, db, knowledgeDir, ctx.cwd);
  created.push(...batch.created);
  skipped.push(...batch.skipped);

  return { created, updated, skipped };
}
