/**
 * LLM interaction helpers for the /ask command orchestrator.
 *
 * Each function wraps a single complete() call with a system prompt,
 * returning a typed result. Separated from ask.ts to stay under the
 * 300-line limit per file.
 *
 * Exports:
 * - evaluateAndPlan — merged keyword-gen + evaluation, outputs {needWebSearch, queries}
 * - planNextRound — merged query-gen + enough-check, outputs {queries, done}
 * - synthesizeAnswer — final synthesis from all sources
 *
 * @module extensions/commands/ask-helpers
 */

import { complete, type UserMessage } from "@earendil-works/pi-ai";

// ── Types ───────────────────────────────────────────────────────────

interface LlmOptions {
  model: Parameters<typeof complete>[0];
  apiKey: string;
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

/** Result of synthesizeAnswer — structured response with LLM-chosen title, tags, and body. */
export interface SynthesisResult {
  title: string;
  tags: string[];
  body: string;
}

/** Result of evaluateAndPlan — merges keyword generation and web-search need. */
export interface EvaluateAndPlanResult {
  needWebSearch: boolean;
  reasoning: string;
  queries: string[];
}

/** Result of planNextRound — merges query generation and sufficiency check. */
export interface PlanNextRoundResult {
  queries: string[];
  done: boolean;
  reasoning: string;
}

// ── Helpers ─────────────────────────────────────────────────────────

/**
 * Extract text content from a complete() response.
 */
function extractText(response: { content: Array<{ type: string; text?: string }> }): string {
  return response.content
    .filter((c): c is { type: "text"; text: string } => c.type === "text")
    .map((c) => c.text)
    .join("\n")
    .trim();
}

/**
 * Evaluate PARA search results and decide whether web search is needed,
 * generating search queries upfront when it is.
 *
 * Merges the old generateKeywords + evaluateResults into one LLM call.
 * Fast-path: when paraResults fully answer the question,
 * returns needWebSearch: false and empty queries.
 *
 * @param question     - The user's original question.
 * @param paraResults  - Results from PARA doc search (snippets).
 * @param opts         - LLM options.
 * @returns Decision and optional web queries.
 */
export async function evaluateAndPlan(
  question: string,
  paraResults: Array<{ title: string; path: string; snippet: string }>,
  opts: LlmOptions,
): Promise<EvaluateAndPlanResult> {
  const resultsText =
    paraResults.length === 0
      ? "No existing knowledge found."
      : paraResults
          .map((r) => `- **${r.title}** (\`${r.path}\`): ${r.snippet.slice(0, 200)}`)
          .join("\n");

  const systemPrompt =
    "You are a research evaluator. Given a question and existing knowledge results:\n" +
    "1. Decide if existing information is sufficient to answer the question.\n" +
    "2. If YES (needWebSearch=false), return empty queries.\n" +
    "3. If NO (needWebSearch=true), generate 2-3 specific web search queries.\n" +
    'Return ONLY a JSON object: { "needWebSearch": boolean, "reasoning": "...", "queries": ["..."] }.\n' +
    "No markdown, no explanation.";

  const userMessage: UserMessage = {
    role: "user",
    content: [
      {
        type: "text",
        text: `Question: ${question}\n\nExisting knowledge results:\n${resultsText}`,
      },
    ],
    timestamp: Date.now(),
  };

  const response = await complete(
    opts.model,
    { systemPrompt, messages: [userMessage] },
    { apiKey: opts.apiKey, headers: opts.headers, signal: opts.signal },
  );

  try {
    const parsed = JSON.parse(extractText(response)) as EvaluateAndPlanResult;
    return {
      needWebSearch: parsed.needWebSearch ?? true,
      reasoning: parsed.reasoning ?? "No reasoning provided.",
      queries: Array.isArray(parsed.queries) ? parsed.queries.slice(0, 3) : [],
    };
  } catch {
    return {
      needWebSearch: true,
      reasoning: "Could not evaluate — proceeding with web search.",
      queries: [question],
    };
  }
}

/**
 * Plan the next web search round: generate queries and decide if we're done.
 *
 * Merges the old generateWebQueries + checkEnoughInfo into one LLM call.
 * When `sources` is empty (first round), generates initial queries.
 * When enough info is gathered, returns done=true with empty queries.
 *
 * @param question   - The user's original question.
 * @param sources    - Sources gathered so far.
 * @param roundNumber - Current round index (0-based).
 * @param opts       - LLM options.
 * @returns Queries for next round and a done flag.
 */
export async function planNextRound(
  question: string,
  sources: Array<{
    title: string;
    url: string;
    citekey: string | null;
    excerpt: string;
  }>,
  roundNumber: number,
  opts: LlmOptions,
): Promise<PlanNextRoundResult> {
  const sourcesText =
    sources.length === 0
      ? "No sources yet."
      : sources
          .map((s) => `- @${s.citekey ?? "?"} ${s.title}: ${s.excerpt.slice(0, 200)}`)
          .join("\n");

  const systemPrompt =
    "You are a web research planner. Given the question and what we've found so far:\n" +
    "1. If enough information exists across sources to answer the question completely, " +
    'set "done": true and return empty queries.\n' +
    "2. If more information is needed, generate 1-3 specific web search queries " +
    'to fill the gaps and set "done": false.\n' +
    'Return ONLY a JSON object: { "queries": ["..."], "done": boolean, "reasoning": "..." }.\n' +
    "No markdown, no explanation.";

  const userMessage: UserMessage = {
    role: "user",
    content: [
      {
        type: "text",
        text: `Question: ${question}\nRound: ${roundNumber + 1}\n\nSources so far:\n${sourcesText}`,
      },
    ],
    timestamp: Date.now(),
  };

  const response = await complete(
    opts.model,
    { systemPrompt, messages: [userMessage] },
    { apiKey: opts.apiKey, headers: opts.headers, signal: opts.signal },
  );

  try {
    const parsed = JSON.parse(extractText(response)) as PlanNextRoundResult;
    return {
      queries: Array.isArray(parsed.queries) ? parsed.queries.slice(0, 3) : [],
      done: parsed.done === true,
      reasoning: parsed.reasoning ?? "",
    };
  } catch {
    // On parse failure, assume done to avoid infinite loops
    return { queries: [], done: true, reasoning: "Parse error — assuming done." };
  }
}

/**
 * Synthesize a final answer from all sources.
 */
export async function synthesizeAnswer(
  question: string,
  sources: Array<{ title: string; content: string; citekey: string | null }>,
  opts: LlmOptions,
  existingTags?: string[],
): Promise<SynthesisResult> {
  const sourcesText = sources
    .map((s) => `---\nSource: @${s.citekey ?? "?"} — ${s.title}\n${s.content.slice(0, 3000)}`)
    .join("\n\n");

  const tagsContext =
    existingTags && existingTags.length > 0
      ? `\nExisting tags in knowledge base: ${existingTags.join(", ")}\n` +
        "Pick from these existing tags when relevant, or add new ones when needed."
      : "";

  const systemPrompt =
    "You are a research synthesis expert. Synthesize a comprehensive answer to the question " +
    "using the provided sources.\n\n" +
    "Return ONLY valid JSON with this exact structure:\n" +
    "{\n" +
    '  "title": "Concise descriptive title for the knowledge document",\n' +
    '  "tags": ["relevant-tag-1", "relevant-tag-2"],\n' +
    '  "body": "## Summary\\n\\n(2-4 paragraphs)... ## Key Points\\n... ## Sources\\n..."\n' +
    "}\n\n" +
    "Rules:\n" +
    "1. Place Pandoc-style citations (@citekey) contextually — at the end of a sentence or paragraph " +
    "that borrows from that source.\n" +
    "2. Structure body with ## Summary, ## Key Points, and ## Sources sections.\n" +
    "3. Pick tags from the provided existing tags list when relevant, or add new ones when needed.\n" +
    "4. No markdown fences, no explanation outside the JSON." +
    tagsContext;

  const userMessage: UserMessage = {
    role: "user",
    content: [
      {
        type: "text",
        text: `Question: ${question}\n\nSources:\n${sourcesText}`,
      },
    ],
    timestamp: Date.now(),
  };

  const response = await complete(
    opts.model,
    { systemPrompt, messages: [userMessage] },
    { apiKey: opts.apiKey, headers: opts.headers, signal: opts.signal },
  );

  const text = extractText(response);
  try {
    const parsed = JSON.parse(text) as SynthesisResult;
    return {
      title: parsed.title ?? `Answer: ${question.slice(0, 60)}`,
      tags: Array.isArray(parsed.tags) ? parsed.tags : [],
      body: parsed.body ?? text,
    };
  } catch {
    return {
      title: `Answer: ${question.slice(0, 60)}`,
      tags: [],
      body: text,
    };
  }
}
