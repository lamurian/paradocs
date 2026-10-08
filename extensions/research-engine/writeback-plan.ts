/**
 * Write-back planning primitives for the decomposed grouping flow.
 *
 * Plan/fill subagent prompts, lenient plan-response parsing (T4-style:
 * tool-call markup stripped, entries validated individually), the
 * corrective-retry prompt quoting bad output, per-note fill prompt
 * assembly, and the plan prompt's source/KB-context builders.
 *
 * @module extensions/research-engine/writeback-plan
 */

import { extractJson, stripToolCallLikeBlocks } from "../../common/extractJson.js";

import type { ResearchSource } from "./types.js";
import type { GroupedOutdated } from "./writeback-helpers.js";

/** Input for one injected or default write-back subagent call (plan/fill). */
export interface WritebackCallInput {
  system: string;
  user: string;
  timeoutMs?: number;
  signal?: AbortSignal;
}

/** Outcome of one injected or default write-back subagent call. */
export interface WritebackCallResult<T> {
  ok: boolean;
  value?: T;
  error?: string;
}

/** One tiny planned note: mapping metadata only, no body. */
export interface PlanEntry {
  title: string;
  tags: string[];
  area?: string;
  sources: string[];
  keyIdea: string;
}

/** Structured plan response: tiny note entries + outdated-note detection. */
export interface PlanResult {
  plan: PlanEntry[];
  outdated: GroupedOutdated[];
}

/** System prompt for the plan call: tiny per-note entries, no bodies. */
export const PLAN_PROMPT = `You plan atomic knowledge base notes from research sources and detect outdated existing notes.

Return ONLY valid JSON. No markdown fences, no explanatory text, no tool-call markup.
{
  "plan": [{"title": "...", "tags": ["..."], "area": "Resources", "sources": ["https://..."], "keyIdea": "..."}],
  "outdated": [{"path": "Resources/foo.md", "reason": "...", "content": "refreshed markdown body"}]
}

Rules:
- One tiny plan entry per atomic note, each covering exactly one key idea; a later call writes each body from its mapped sources.
- "sources" lists the source URLs (from the research sources list) the note draws on.
- area is one of "Resources", "Areas", "Projects" (default "Resources").
- Mark an existing note outdated ONLY when the new sources supersede it; provide the refreshed markdown body in "content".
- Keep tags short and reusable.`;

/** System prompt for the per-note fill call: one markdown body. */
export const FILL_PROMPT = `You write ONE atomic knowledge base note body in markdown from its mapped sources.

Rules:
- Exactly one key idea (atomic principle). Recommended sections: ## Summary, ## Key Points, ## Sources.
- Cite sources in the body using @citekey notation from the mapped sources list.
- Return ONLY the markdown body. No JSON, no code fences, no commentary.`;

/**
 * Parse and validate the plan LLM response (lenient).
 *
 * Tool-call-like markup is stripped before JSON extraction. Plan entries
 * are validated individually: entries lacking a non-empty string title or
 * a non-empty string-array "sources" are dropped, so one malformed entry
 * never nulls a response that still carries valid entries. Missing
 * "outdated" arrays default to []; null only when "plan" is missing or
 * has zero valid entries.
 *
 * @param text - Raw LLM response text.
 * @returns Parsed plan result, or null when no valid entry remains.
 */
export function parsePlan(text: string): PlanResult | null {
  const parsed = extractJson(stripToolCallLikeBlocks(text));
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const obj = parsed as { plan?: unknown; outdated?: GroupedOutdated[] };
  if (!Array.isArray(obj.plan)) return null;
  const plan = obj.plan.filter(isUsablePlanEntry).map(normalizePlanEntry);
  if (plan.length === 0) return null;
  return { plan, outdated: Array.isArray(obj.outdated) ? obj.outdated : [] };
}

/** A plan entry is usable when it carries a title and at least one source url. */
function isUsablePlanEntry(entry: unknown): boolean {
  if (typeof entry !== "object" || entry === null) return false;
  const e = entry as { title?: unknown; sources?: unknown };
  return (
    typeof e.title === "string" &&
    e.title.trim().length > 0 &&
    Array.isArray(e.sources) &&
    e.sources.length > 0 &&
    e.sources.every((s) => typeof s === "string" && s.trim().length > 0)
  );
}

/** Fill optional plan-entry fields with schema defaults. */
function normalizePlanEntry(entry: unknown): PlanEntry {
  const e = entry as {
    title: string;
    tags?: unknown;
    area?: unknown;
    sources: string[];
    keyIdea?: unknown;
  };
  return {
    title: e.title,
    tags: Array.isArray(e.tags) ? e.tags.filter((t): t is string => typeof t === "string") : [],
    area: typeof e.area === "string" && e.area.trim().length > 0 ? e.area : "Resources",
    sources: e.sources,
    keyIdea: typeof e.keyIdea === "string" ? e.keyIdea : "",
  };
}

/**
 * Extract the bad-output snippet quoted in the corrective plan retry.
 *
 * @param error - Error string from the failed plan call.
 * @returns The response-text excerpt with the transport prefix removed.
 */
export function badOutputSnippet(error: string): string {
  return error.replace(/^unparseable subagent response:\s*/, "");
}

/**
 * Build the corrective plan prompt quoting the failed attempt's bad output.
 *
 * @param originalUser - The original plan user prompt.
 * @param error - Error string from the failed plan call.
 * @returns Corrective prompt: diagnostic quote + original request.
 */
export function correctivePlanUser(originalUser: string, error: string): string {
  return [
    "Your previous plan response could not be used.",
    `Error: ${error}`,
    "Bad output snippet:",
    badOutputSnippet(error),
    "",
    "Return ONLY valid JSON matching the plan schema. No markdown fences, no tool-call markup, no commentary.",
    "",
    originalUser,
  ].join("\n");
}

/**
 * Map one plan entry's source urls to citekey/snippet lines for its fill.
 *
 * @param entry - Planned note entry.
 * @param sources - Collected research sources.
 * @param citekeys - Resolved URL -> citekey map.
 * @returns Markdown bullet lines for the fill prompt.
 */
export function mapEntrySources(
  entry: PlanEntry,
  sources: ResearchSource[],
  citekeys: Map<string, string>,
): string {
  const byUrl = new Map(sources.map((s) => [s.url, s]));
  const lines = entry.sources.map((url) => {
    const src = byUrl.get(url);
    const cite = citekeys.get(url);
    const head = `- ${url}${cite ? ` (@${cite})` : ""}${src?.title ? ` (${src.title})` : ""}`;
    return src?.snippet ? `${head}: ${src.snippet}` : head;
  });
  return lines.join("\n") || "- (no resolved sources; write from the key idea alone)";
}

/**
 * Build the per-note fill user prompt from a plan entry and mapped sources.
 *
 * @param entry - Planned note entry.
 * @param sourceLines - Mapped source lines from mapEntrySources.
 * @returns User prompt for one fill call.
 */
export function fillUser(entry: PlanEntry, sourceLines: string): string {
  return [
    `Title: ${entry.title}`,
    `Tags: ${entry.tags.join(", ")}`,
    `Area: ${entry.area ?? "Resources"}`,
    `Key idea: ${entry.keyIdea}`,
    "",
    "Mapped sources (cite with @citekey):",
    sourceLines,
  ].join("\n");
}

/** Minimal KB doc shape used in the plan prompt's context section. */
export interface KbDoc {
  title: string;
  path: string;
  body: string;
  created?: string | null;
}

/**
 * Build the KB-context section of the plan user prompt.
 *
 * @param docs - KB docs from the deterministic notes search.
 * @returns Markdown bullet lines, or a no-results note.
 */
export function buildKbContext(docs: KbDoc[]): string {
  if (docs.length === 0) return "No existing documents found.";
  return docs
    .map(
      (d) =>
        `- **${d.title}** (\`${d.path}\`)${d.created ? ` (date: ${d.created.slice(0, 10)})` : ""}: ${d.body.slice(0, 300)}`,
    )
    .join("\n");
}

/**
 * Build the research-sources section of the plan user prompt.
 *
 * @param sources - Collected research sources.
 * @param citekeys - Resolved URL -> citekey map.
 * @returns Markdown bullet lines with url, title, citekey, snippet.
 */
export function buildSourcesStr(sources: ResearchSource[], citekeys: Map<string, string>): string {
  return sources
    .map(
      (s) =>
        `- ${s.url}${s.title ? ` (${s.title})` : ""} (@${citekeys.get(s.url) ?? "unresolved"}): ${s.snippet}`,
    )
    .join("\n");
}

/**
 * Reason string for a failed or invalid plan call result.
 *
 * @param res - Plan call result.
 * @returns Error text, or 'invalid plan response' for ok-but-empty results.
 */
export function planFailureReason(res: WritebackCallResult<PlanResult>): string {
  if (res.ok) return "invalid plan response";
  return res.error ?? "plan failed";
}

/**
 * Run the plan call with exactly one corrective retry quoting bad output.
 *
 * @param plan - Plan call (injected or default subagent plan).
 * @param input - Plan call input.
 * @param onProgress - Optional progress channel for the retry notice.
 * @returns The final plan call result (ok or not).
 */
export async function planWithRetry(
  plan: (input: WritebackCallInput) => Promise<WritebackCallResult<PlanResult>>,
  input: WritebackCallInput,
  onProgress?: (message: string) => void,
): Promise<WritebackCallResult<PlanResult>> {
  const first = await plan(input);
  if (first.ok && first.value) return first;
  const reason = planFailureReason(first);
  onProgress?.(`write-back plan retry after bad output: ${badOutputSnippet(reason)}`);
  return plan({ ...input, user: correctivePlanUser(input.user, reason) });
}
