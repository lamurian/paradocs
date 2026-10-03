/**
 * Pure pipeline pieces used by stage execution: prompt loading, strict
 * parsers for every LLM boundary, and the long-document summarization
 * planner (whole-doc → chunk map-reduce → head+tail).
 *
 * @module extensions/research-engine/effects
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { stripBoilerplate } from "./fetcher.js";
import { extractJson } from "../../common/extractJson.js";

import type { Effect, FetchRecord, JudgeResult } from "./state.js";

// ── Long-document policy ──────────────────────────────────────────────

/** Whole-doc summarization cap (chars). */
export const WHOLE_DOC_MAX = 35_000;

/** Above this size, docs get head+tail extraction instead of chunking. */
export const HEAD_TAIL_MAX = 200_000;

/** Total budget for head+tail extraction (chars). */
export const HEAD_TAIL_BUDGET = 35_000;

/** Deterministic summarization plan for one document. */
export type SummarizationPlan =
  | { mode: "whole"; text: string }
  | { mode: "chunks"; chunks: string[] }
  | { mode: "head_tail"; text: string; truncation: "head_tail" };

function splitChunks(text: string): string[] {
  const chunks: string[] = [];
  let rest = text;
  while (rest.length > WHOLE_DOC_MAX) {
    let cut = rest.lastIndexOf("\n\n", WHOLE_DOC_MAX);
    if (cut < WHOLE_DOC_MAX * 0.5) cut = WHOLE_DOC_MAX;
    chunks.push(rest.slice(0, cut));
    rest = rest.slice(cut).replace(/^\n+/, "");
  }
  if (rest.trim()) chunks.push(rest);
  return chunks;
}

/**
 * Plan how to summarize a document based on its cleaned size.
 *
 * ≤35K chars → whole doc. ≤200K → chunked map-reduce (ceil(len/35K) chunks).
 * Above → head+tail within the budget, flagged `truncation: "head_tail"`.
 *
 * @param rawContent - Raw extracted document text.
 * @returns The summarization plan.
 */
export function planSummarization(rawContent: string): SummarizationPlan {
  const text = stripBoilerplate(rawContent);
  if (text.length <= WHOLE_DOC_MAX) return { mode: "whole", text };
  if (text.length <= HEAD_TAIL_MAX) return { mode: "chunks", chunks: splitChunks(text) };
  const head = Math.floor(HEAD_TAIL_BUDGET * 0.7);
  const tail = HEAD_TAIL_BUDGET - head;
  return {
    mode: "head_tail",
    text: text.slice(0, head) + "\n\n[... middle of document omitted ...]\n\n" + text.slice(-tail),
    truncation: "head_tail",
  };
}

/**
 * Build summarize effects for the successfully fetched records.
 *
 * Whole/head-tail docs produce one `summarize` effect; long docs produce
 * one `summarize_chunk` effect per chunk plus one `summarize_merge`.
 *
 * @param records - Fetch records from the FETCH stage.
 * @returns Summarize effects in record order.
 */
export function buildSummarizeEffects(records: FetchRecord[]): Effect[] {
  const effects: Effect[] = [];
  for (const r of records) {
    if (!r.ok || !r.content) continue;
    const plan = planSummarization(r.content);
    if (plan.mode === "chunks") {
      plan.chunks.forEach((chunk, index) => {
        effects.push({
          kind: "summarize_chunk",
          url: r.url,
          canonicalUrl: r.canonicalUrl,
          index,
          chunkCount: plan.chunks.length,
          text: chunk,
        });
      });
      effects.push({
        kind: "summarize_merge",
        url: r.url,
        canonicalUrl: r.canonicalUrl,
        chunkCount: plan.chunks.length,
      });
    } else {
      effects.push({
        kind: "summarize",
        url: r.url,
        canonicalUrl: r.canonicalUrl,
        mode: plan.mode,
        text: plan.text,
        ...(plan.mode === "head_tail" ? { truncation: plan.truncation } : {}),
      });
    }
  }
  return effects;
}

// ── Prompt loading ────────────────────────────────────────────────────

const PROMPT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "prompts");
const promptCache = new Map<string, string>();

/**
 * Load a system prompt from the prompts directory (cached).
 *
 * @param name - Prompt file base name (e.g. "query-gen").
 * @returns Prompt text; empty string when the file is missing.
 */
export function prompt(name: string): string {
  const cached = promptCache.get(name);
  if (cached !== undefined) return cached;
  let text: string;
  try {
    text = readFileSync(resolve(PROMPT_DIR, `${name}.md`), "utf-8");
  } catch {
    text = "";
  }
  promptCache.set(name, text);
  return text;
}

// ── LLM boundary parsers ──────────────────────────────────────────────

function strArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((x): x is string => typeof x === "string" && x.trim().length > 0)
    .map((s) => s.trim());
}

/**
 * Parse the query-gen LLM response.
 *
 * @param text - Raw LLM output.
 * @returns Queries + kbSufficient verdict, or null when invalid.
 */
export function parseQueries(
  text: string,
): { queries: string[]; kbSufficient: boolean | null } | null {
  const parsed = extractJson(text);
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const obj = parsed as { queries?: unknown; kb_sufficient?: unknown };
  const queries = strArray(obj.queries).slice(0, 6);
  if (queries.length === 0) return null;
  return {
    queries,
    kbSufficient: typeof obj.kb_sufficient === "boolean" ? obj.kb_sufficient : null,
  };
}

/**
 * Parse the rank LLM response into canonical URLs filtered to the allowed set.
 *
 * @param text - Raw LLM output (array of URLs).
 * @param allowed - Canonical URLs the ranker may choose from.
 * @returns Ordered canonical URLs, or null when nothing valid remains.
 */
export function parseRanked(text: string, allowed: Set<string>): string[] | null {
  const parsed = extractJson(text);
  const urls = strArray(parsed);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const u of urls) {
    if (allowed.has(u) && !seen.has(u)) {
      seen.add(u);
      out.push(u);
    }
  }
  return out.length > 0 ? out : null;
}

/**
 * Parse a per-source summarizer response (plain summary text).
 *
 * @param text - Raw LLM output.
 * @returns Trimmed summary, or null when empty.
 */
export function parseSummaryText(text: string): string | null {
  const cleaned = text
    .replace(/^```(?:markdown|md)?\s*\n?/i, "")
    .replace(/\n?```\s*$/i, "")
    .trim();
  return cleaned.length > 0 ? cleaned : null;
}

/**
 * Parse the judge LLM response.
 *
 * @param text - Raw LLM output.
 * @returns Judge verdict, or null when invalid.
 */
export function parseJudge(text: string): JudgeResult | null {
  const parsed = extractJson(text);
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const obj = parsed as { sufficient?: unknown; gaps?: unknown };
  if (typeof obj.sufficient !== "boolean") return null;
  return { sufficient: obj.sufficient, gaps: strArray(obj.gaps) };
}

/**
 * Parse the reformulate (refine) LLM response.
 *
 * @param text - Raw LLM output.
 * @returns Next-cycle questions + covered facets, or null when invalid.
 */
export function parseRefine(text: string): { questions: string[]; coveredFacets: string[] } | null {
  const parsed = extractJson(text);
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const obj = parsed as { questions?: unknown; covered_facets?: unknown };
  const questions = strArray(obj.questions).slice(0, 6);
  if (questions.length === 0) return null;
  return { questions, coveredFacets: strArray(obj.covered_facets) };
}

/**
 * Parse the synthesis LLM response.
 *
 * @param text - Raw LLM output.
 * @returns Answer text, or null when empty.
 */
export function parseSynthesis(text: string): string | null {
  const cleaned = text.trim();
  return cleaned.length > 0 ? cleaned : null;
}
