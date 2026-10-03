/**
 * SUMMARIZE stage executor: one source per LLM call, parallel with a
 * bounded concurrency limit; long docs via chunk map-reduce.
 *
 * @module extensions/research-engine/stage-summarize
 */

import { parseSummaryText, planSummarization, prompt } from "./effects.js";

import type { ResearchEvent } from "./events.js";
import type { ResearchDeps } from "./research-deps.js";
import type { FailureRecord, FetchRecord, ResearchState, SummaryItem } from "./state.js";

/** Summarizer concurrency across sources. */
const SUMMARIZE_CONCURRENCY = 4;

/** Result of summarizing one fetched record. */
interface OneSummary {
  item?: SummaryItem;
  failure?: FailureRecord;
  llmError: boolean;
}

/** Shared per-record fields for summary items. */
interface SummaryBase {
  url: string;
  canonicalUrl: string;
  title?: string;
}

/**
 * Run tasks with a bounded concurrency limit, preserving input order.
 *
 * @param items - Items to process.
 * @param limit - Max concurrent tasks.
 * @param fn - Task function.
 * @returns Results in input order.
 */
async function mapLimit<TIn, TOut>(
  items: TIn[],
  limit: number,
  fn: (item: TIn) => Promise<TOut>,
): Promise<TOut[]> {
  const results = new Array<TOut>(items.length);
  let next = 0;
  async function worker(): Promise<void> {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

function summarizerUser(state: ResearchState, rec: FetchRecord, part: string): string {
  return `Question: ${state.question}\nSource: ${rec.url}${rec.title ? ` (${rec.title})` : ""}\n\n${part}`;
}

function summarizeFailure(url: string, error: string): OneSummary {
  return { failure: { stage: "SUMMARIZE", url, error }, llmError: true };
}

/** Chunked map-reduce summarize: parallel chunk summaries + one merge call. */
async function summarizeChunks(
  state: ResearchState,
  deps: ResearchDeps,
  rec: FetchRecord,
  base: SummaryBase,
  chunks: string[],
  truncation: { truncation?: "head_tail" },
): Promise<OneSummary> {
  const chunkResults = await Promise.all(
    chunks.map((chunk) =>
      deps.llm({
        system: prompt("summarizer"),
        user: summarizerUser(state, rec, chunk),
        parse: (t) => parseSummaryText(t),
        timeoutMs: deps.llmTimeoutMs,
        label: "Summarizing…",
      }),
    ),
  );
  const bad = chunkResults.some((r) => !r.ok || typeof r.value !== "string");
  if (bad) {
    const err = chunkResults.find((r) => !r.ok);
    return summarizeFailure(
      rec.url,
      err && !err.ok ? (err.error ?? "chunk summarize failed") : "chunk summarize failed",
    );
  }
  const digest = chunkResults.map((r, i) => `Part ${i + 1}:\n${r.value as string}`).join("\n\n");
  const merged = await deps.llm({
    system: prompt("summarizer"),
    user: summarizerUser(
      state,
      rec,
      `The source was split for length. Merge these part summaries into one summary:\n\n${digest}`,
    ),
    parse: (t) => parseSummaryText(t),
    timeoutMs: deps.llmTimeoutMs,
    label: "Summarizing…",
  });
  if (!merged.ok || typeof merged.value !== "string") {
    return summarizeFailure(
      rec.url,
      !merged.ok ? (merged.error ?? "merge summarize failed") : "merge summarize failed",
    );
  }
  return finalize(base, merged.value, truncation);
}

/** Single-call summarize for whole-doc and head+tail plans. */
async function summarizeSingle(
  state: ResearchState,
  deps: ResearchDeps,
  rec: FetchRecord,
  base: SummaryBase,
  text: string,
  truncation: { truncation?: "head_tail" },
): Promise<OneSummary> {
  const res = await deps.llm({
    system: prompt("summarizer"),
    user: summarizerUser(state, rec, text),
    parse: (t) => parseSummaryText(t),
    timeoutMs: deps.llmTimeoutMs,
    label: "Summarizing…",
  });
  if (!res.ok || typeof res.value !== "string") {
    return summarizeFailure(
      rec.url,
      !res.ok ? (res.error ?? "summarize failed") : "summarize failed",
    );
  }
  return finalize(base, res.value, truncation);
}

/** Summarize one record per its summarization plan. */
async function summarizeOne(
  state: ResearchState,
  deps: ResearchDeps,
  rec: FetchRecord,
): Promise<OneSummary> {
  const plan = planSummarization(rec.content ?? "");
  const base: SummaryBase = { url: rec.url, canonicalUrl: rec.canonicalUrl, title: rec.title };
  const truncation = plan.mode === "head_tail" ? ({ truncation: "head_tail" } as const) : {};
  if (plan.mode === "chunks") {
    return summarizeChunks(state, deps, rec, base, plan.chunks, truncation);
  }
  return summarizeSingle(state, deps, rec, base, plan.text, truncation);
}

function finalize(
  base: SummaryBase,
  summary: string,
  truncation: { truncation?: "head_tail" },
): OneSummary {
  if (summary.trim().length === 0 || summary.trim() === "IRRELEVANT") return { llmError: false };
  return { item: { ...base, summary, ...truncation }, llmError: false };
}

/**
 * SUMMARIZE: summarize every successfully fetched record.
 *
 * @param state - Current research state.
 * @param deps - Injected I/O surface.
 * @returns summarized event with items, typed failures, and error count.
 */
export async function stageSummarize(
  state: ResearchState,
  deps: ResearchDeps,
): Promise<ResearchEvent> {
  const okRecords = state.fetches.filter((f) => f.ok && f.content);
  const outcomes = await mapLimit(okRecords, SUMMARIZE_CONCURRENCY, (rec) =>
    summarizeOne(state, deps, rec),
  );
  const items: SummaryItem[] = [];
  const failures: FailureRecord[] = [];
  let llmErrors = 0;
  for (const o of outcomes) {
    if (o.item) items.push(o.item);
    if (o.failure) failures.push(o.failure);
    if (o.llmError) llmErrors++;
  }
  return { type: "summarized", items, failures, llmErrors };
}
