/**
 * LLM interaction helpers for the /ask command orchestrator.
 *
 * Each function wraps a single complete() call with a system prompt,
 * returning a typed result. Separated from ask.ts to stay under the
 * 300-line limit per file.
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
 * Generate 3-5 search keywords from the user's question.
 */
export async function generateKeywords(question: string, opts: LlmOptions): Promise<string[]> {
  const systemPrompt =
    "You are a research query generator. Given a question, generate 3-5 search queries " +
    'to search a knowledge base. Return ONLY a JSON array of strings, e.g. ["query1", "query2"]. ' +
    "No markdown, no explanation.";

  const userMessage: UserMessage = {
    role: "user",
    content: [{ type: "text", text: `Generate search queries for: ${question}` }],
    timestamp: Date.now(),
  };

  const response = await complete(
    opts.model,
    { systemPrompt, messages: [userMessage] },
    { apiKey: opts.apiKey, headers: opts.headers, signal: opts.signal },
  );

  const text = extractText(response);
  try {
    const parsed = JSON.parse(text) as unknown;
    if (Array.isArray(parsed) && parsed.every((s) => typeof s === "string")) {
      return parsed.slice(0, 5);
    }
  } catch {
    const matches = text.match(/"([^"]+)"/g);
    if (matches) return matches.map((m) => m.replace(/"/g, "")).slice(0, 5);
  }
  return [question];
}

/**
 * Evaluate PARA search results and decide if web search is needed.
 */
export async function evaluateResults(
  question: string,
  paraResults: Array<{ title: string; path: string; snippet: string }>,
  opts: LlmOptions,
): Promise<{ needWebSearch: boolean; reasoning: string }> {
  const resultsText =
    paraResults.length === 0
      ? "No existing knowledge found."
      : paraResults
          .map((r) => `- **${r.title}** (\`${r.path}\`): ${r.snippet.slice(0, 200)}`)
          .join("\n");

  const systemPrompt =
    "You are a research evaluator. Given a question and existing knowledge results, " +
    "decide if the existing information is sufficient to answer the question " +
    "or if web search is needed. Return ONLY a JSON object: " +
    '{ "needWebSearch": boolean, "reasoning": "..." }. No markdown, no explanation.';

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
    return JSON.parse(extractText(response)) as {
      needWebSearch: boolean;
      reasoning: string;
    };
  } catch {
    return {
      needWebSearch: true,
      reasoning: "Could not evaluate — proceeding with web search.",
    };
  }
}

/**
 * Generate web search queries for the next round of research.
 */
export async function generateWebQueries(
  question: string,
  sources: Array<{ title: string; url: string; citekey: string | null }>,
  round: number,
  opts: LlmOptions,
): Promise<string[]> {
  const sourcesText =
    sources.length === 0
      ? "No sources yet."
      : sources.map((s) => `- ${s.title} (${s.url}) Citekey: @${s.citekey ?? "none"}`).join("\n");

  const systemPrompt =
    "You are a web research planner. Given the question and what we've found so far, " +
    "generate specific web search queries to fill knowledge gaps. " +
    "Return ONLY a JSON array of strings. No markdown, no explanation.";

  const userMessage: UserMessage = {
    role: "user",
    content: [
      {
        type: "text",
        text: `Question: ${question}\nRound: ${round + 1}\n\nSources so far:\n${sourcesText}`,
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
    const parsed = JSON.parse(extractText(response)) as unknown;
    if (Array.isArray(parsed) && parsed.every((s) => typeof s === "string")) {
      return parsed.slice(0, 3);
    }
  } catch {
    /* fall through */
  }
  return [question];
}

/**
 * Check if we have enough information after a web search round.
 */
export async function checkEnoughInfo(
  question: string,
  sources: Array<{
    title: string;
    url: string;
    citekey: string | null;
    excerpt: string;
  }>,
  opts: LlmOptions,
): Promise<boolean> {
  const sourcesText = sources
    .map((s) => `- @${s.citekey ?? "?"} ${s.title}: ${s.excerpt.slice(0, 200)}`)
    .join("\n");

  const systemPrompt =
    "You are a research completeness checker. Given the question and gathered sources, " +
    "decide if we have enough information to write a comprehensive answer. " +
    'Return ONLY JSON: { "enough": boolean, "gaps": ["..."] }.';

  const userMessage: UserMessage = {
    role: "user",
    content: [{ type: "text", text: `Question: ${question}\n\nSources:\n${sourcesText}` }],
    timestamp: Date.now(),
  };

  const response = await complete(
    opts.model,
    { systemPrompt, messages: [userMessage] },
    { apiKey: opts.apiKey, headers: opts.headers, signal: opts.signal },
  );

  try {
    const decision = JSON.parse(extractText(response)) as { enough: boolean };
    return decision.enough === true;
  } catch {
    return true;
  }
}

/**
 * Synthesize a final answer from all sources.
 */
export async function synthesizeAnswer(
  question: string,
  sources: Array<{ title: string; content: string; citekey: string | null }>,
  opts: LlmOptions,
): Promise<string> {
  const sourcesText = sources
    .map((s) => `---\nSource: @${s.citekey ?? "?"} — ${s.title}\n${s.content.slice(0, 3000)}`)
    .join("\n\n");

  const systemPrompt =
    "You are a research synthesis expert. Synthesize a comprehensive answer to the question " +
    "using the provided sources. Structure your response with:\n" +
    "## Summary (2-4 paragraphs)\n" +
    "## Key Points\n" +
    "## Sources\n\n" +
    "Use Pandoc-style citations (@citekey) for each claim from web sources. " +
    "For claims from existing knowledge documents, use [Document Title](path).";

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

  return extractText(response);
}
