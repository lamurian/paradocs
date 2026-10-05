/**
 * Search-stage runner — spawns one lean pi subagent with the web_search
 * tool, parses its {sources, coveredFacets} JSON contract, and emits the
 * FSM search_done event with canonicalized, visited-filtered candidates.
 *
 * Fixes the old runner's path-vs-literal bug: --append-system-prompt
 * receives the literal researcher.md contents, never the file path.
 *
 * @module extensions/research-engine/runner
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { canonicalizeUrl } from "./fetcher.js";
import { extractJson } from "../../common/extractJson.js";
import { buildSubagentArgs } from "../../common/subagent.js";

import type { ResearchEvent } from "./events.js";
import type { ResearchDeps } from "./research-deps.js";
import type { Candidate, KbDocGist, ResearchState } from "./state.js";
import type { SearchSubagentValue } from "./types.js";

const HERE = dirname(fileURLToPath(import.meta.url));

/** Literal path to the researcher system prompt (read as text, never passed as a path). */
export const RESEARCHER_PROMPT_PATH = resolve(HERE, "prompts", "researcher.md");

/** Absolute path to the web-search extension loaded by the search subagent. */
export const WEB_SEARCH_EXT_PATH = resolve(HERE, "..", "web-search");

/**
 * Build argv for the search subagent.
 *
 * --append-system-prompt receives the literal researcher.md contents
 * (read in the parent process), never the file path.
 *
 * @param input - Provider/model ids and the task text.
 * @returns Full argv array for the pi subprocess.
 */
export function buildSearchAgentArgs(input: {
  provider: string;
  modelId: string;
  task: string;
}): string[] {
  const systemPrompt = readFileSync(RESEARCHER_PROMPT_PATH, "utf-8");
  return buildSubagentArgs({
    provider: input.provider,
    modelId: input.modelId,
    systemPrompt,
    task: input.task,
    extraArgs: ["-e", WEB_SEARCH_EXT_PATH, "--tools", "web_search"],
  });
}

/**
 * Parse and validate the search subagent's JSON contract.
 *
 * Malformed entries (missing url or non-string snippet) are dropped;
 * duplicate URLs keep the first occurrence; missing coveredFacets
 * defaults to []. Non-JSON or non-object output yields null.
 *
 * @param text - Raw final assistant text from the subagent.
 * @returns Validated value, or null when the contract is not met.
 */
export function parseSearchResult(text: string): SearchSubagentValue | null {
  const parsed = extractJson(text);
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const obj = parsed as { sources?: unknown; coveredFacets?: unknown };
  if (!Array.isArray(obj.sources)) return null;
  const seen = new Set<string>();
  const sources: SearchSubagentValue["sources"] = [];
  for (const entry of obj.sources) {
    if (entry === null || typeof entry !== "object") continue;
    const s = entry as { url?: unknown; title?: unknown; snippet?: unknown; tier?: unknown };
    if (typeof s.url !== "string" || s.url.length === 0) continue;
    if (typeof s.snippet !== "string") continue;
    if (seen.has(s.url)) continue;
    seen.add(s.url);
    sources.push({
      url: s.url,
      snippet: s.snippet,
      ...(typeof s.title === "string" ? { title: s.title } : {}),
      ...(typeof s.tier === "number" ? { tier: s.tier } : {}),
    });
  }
  const coveredFacets = Array.isArray(obj.coveredFacets)
    ? obj.coveredFacets.filter((f): f is string => typeof f === "string" && f.trim().length > 0)
    : [];
  return { sources, coveredFacets };
}

function describePhase(state: ResearchState): string {
  const breadth = state.mode === "breadth" && state.cycle === 1;
  return breadth ? "breadth" : `depth (cycle ${state.cycle})`;
}

/**
 * Build the search subagent task text from pipeline state.
 *
 * Includes the question, phase, KB doc titles (context only), known
 * gaps, covered facets, visited URLs, and already-asked questions so
 * next cycles target what earlier cycles missed.
 *
 * @param state - Current research state.
 * @returns Task text for the subagent positional prompt.
 */
export function buildSearchTask(state: ResearchState): string {
  const lines = [
    `Question: ${state.question}`,
    `Phase: ${describePhase(state)}`,
    state.kbDocs.length > 0
      ? `KB documents (context only — do not write to them):\n${state.kbDocs
          .map((d: KbDocGist) => `- ${d.title}${d.date ? ` (${d.date.slice(0, 10)})` : ""}`)
          .join("\n")}`
      : "KB documents: none found",
    state.gaps.length > 0
      ? `Known gaps from earlier cycles (target these):\n${state.gaps.map((g) => `- ${g}`).join("\n")}`
      : "",
    state.coveredFacets.length > 0
      ? `Facets already covered (do not re-cover):\n${state.coveredFacets.join(", ")}`
      : "",
    state.visited.length > 0
      ? `URLs already collected (never repeat):\n${state.visited.map((u) => `- ${u}`).join("\n")}`
      : "",
    state.askedQuestions.length > 0
      ? `Questions already asked:\n${state.askedQuestions.map((q) => `- ${q}`).join("\n")}`
      : "",
  ];
  return lines.filter(Boolean).join("\n\n");
}

/**
 * SEARCH stage executor: KB search stays deterministic (already in
 * state.kbDocs from the previous cycle start); this stage runs the
 * search subagent and maps its output to FSM candidates.
 *
 * @param state - Current research state.
 * @param deps - Injected I/O surface (searchSubagent).
 * @returns search_done event with candidates, KB docs, and covered facets.
 */
export async function runSearchStage(
  state: ResearchState,
  deps: ResearchDeps,
): Promise<ResearchEvent> {
  const task = buildSearchTask(state);
  const res = await deps.searchSubagent({ task });

  if (!res.ok || !res.value) {
    return {
      type: "search_done",
      candidates: [],
      kbDocs: state.kbDocs,
      queries: [state.question],
      coveredFacets: [],
      llmErrors: 1,
      failures: [
        {
          stage: "SEARCH",
          error: res.error ?? "search subagent failed",
        },
      ],
    };
  }

  const visited = new Set(state.visited);
  const seen = new Set<string>();
  const candidates: Candidate[] = [];
  for (const s of res.value.sources) {
    const canonicalUrl = canonicalizeUrl(s.url);
    if (visited.has(canonicalUrl) || seen.has(canonicalUrl)) continue;
    seen.add(canonicalUrl);
    candidates.push({
      url: s.url,
      canonicalUrl,
      title: s.title,
      snippet: s.snippet,
      tier: s.tier ?? 3,
      query: state.question,
    });
  }

  return {
    type: "search_done",
    candidates,
    kbDocs: state.kbDocs,
    queries: [state.question],
    coveredFacets: res.value.coveredFacets,
    llmErrors: 0,
  };
}
