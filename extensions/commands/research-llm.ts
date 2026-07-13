/**
 * LLM interaction helpers for the /research command.
 *
 * Provides the BorderedLoader-based LLM call pattern and prompts for
 * sufficiency evaluation and question decomposition.
 *
 * @module extensions/commands/research-llm
 */

import { complete, type UserMessage } from "@earendil-works/pi-ai";
import { BorderedLoader } from "@earendil-works/pi-coding-agent";

// ── Prompts ────────────────────────────────────────────────────────

/** System prompt for sufficiency evaluation of existing knowledge. */
export const SUFFICIENCY_PROMPT = `You are a research analyst. Given a research topic and existing knowledge base documents, determine whether the existing documents fully and satisfactorily answer the topic.

CRITICAL: Return ONLY raw JSON. DO NOT wrap in markdown fences (no \`\`\`json).
DO NOT add any explanatory text before or after the JSON.

✅ Good: {"sufficient": false, "rationale": "...", "answer": ""}
❌ Bad: \`\`\`json\n{"sufficient": false...}\n\`\`\`  (NO!)
❌ Bad: Here is the JSON: {"sufficient": false...}  (NO!)

Return ONLY a JSON object with this exact structure:
{
  "sufficient": true,
  "rationale": "Brief explanation of the assessment",
  "answer": "If sufficient, a comprehensive answer synthesising the existing documents with @citekey citations. Empty string if insufficient."
}

Optionally, if the existing documents collectively provide enough information but your answer represents a novel synthesis not found in any single document, set "sufficient": true AND "createNote": true along with "noteTitle", "noteContent", and "noteTags" for a new atomic document that captures this synthesis.

Evaluate carefully:
- sufficient=true only if the documents collectively provide a complete, well-sourced answer
- sufficient=false if major gaps exist, sources are weak, or the topic is only partially covered
- createNote=true when your answer is a novel synthesis across multiple documents that should be saved as a new atomic note
- In the answer, cite sources using @citekey notation from the document content
- Optional "commitMessage": a descriptive git commit message for the note(s) being created, e.g. "docs: add synthesis comparing living fences and concrete walls"`;

/**
 * Stricter sufficiency prompt for /research command.
 *
 * Unlike the generic SUFFICIENCY_PROMPT (also used by /ask), this prompt
 * raises the bar: sufficient=true ONLY if existing docs exhaustively cover
 * ALL major facets of the topic. Partial or related coverage is NOT sufficient.
 * Also instructs the LLM to decompose novel syntheses into multiple atomic
 * notes via the notes[] field.
 */
export const RESEARCH_SUFFICIENCY_PROMPT = `You are a research analyst. Given a research topic and existing knowledge base documents, determine whether the existing documents exhaustively answer the topic.

CRITICAL: Return ONLY raw JSON. DO NOT wrap in markdown fences (no \`\`\`json).
DO NOT add any explanatory text before or after the JSON.

✅ Good: {"sufficient": false, "rationale": "...", "answer": ""}
❌ Bad: \`\`\`json\n{"sufficient": false...}\n\`\`\`  (NO!)
❌ Bad: Here is the JSON: {"sufficient": false...}  (NO!)

Return ONLY a JSON object with this exact structure:
{
  "sufficient": true,
  "rationale": "Brief explanation of the assessment",
  "answer": "If sufficient, a comprehensive answer synthesising the existing documents with @citekey citations. Empty string if insufficient."
}

If sufficient AND your answer represents a novel synthesis not found in any single existing document, set "createNote": true and decompose into atomic notes:
- If multiple distinct sub-topics emerged, use "notes": [{"title": "...", "content": "...", "tags": ["..."]}]
  Each note must cover exactly one key idea, max 6 paragraphs or 3 headings.
- For a single focused synthesis, use legacy fields: "noteTitle", "noteContent", "noteTags"

EVALUATE STRICTLY:
- sufficient=true ONLY if the existing documents collectively and EXHAUSTIVELY answer ALL major facets of the topic
- sufficient=false if any major aspect is missing, sources are weak, or coverage is only partial or related
- Related or partial coverage is NOT sufficient — only complete, multi-faceted coverage counts
- createNote=true when your answer is a novel synthesis across multiple documents
- Decompose into notes[] when the synthesis covers multiple distinct sub-topics
- In the answer, cite sources using @citekey notation from the document content
- Optional "commitMessage": a descriptive git commit message for the note(s) being created, e.g. "docs: research dopamine's role in incentive salience"`;

// ── Types ──────────────────────────────────────────────────────────

// ── Result type ───────────────────────────────────────────────────────

/**
 * Tagged union for LLM call results.
 *
 * Distinguishes successful parsing, user cancellation, and errors
 * so callers can show appropriate messages instead of conflating
 * all failures as "cancelled."
 */
export type LlmCallResult<T> =
  | { ok: true; value: T }
  | { ok: false; type: "cancelled" }
  | { ok: false; type: "error"; message: string };

// ── Types ──────────────────────────────────────────────────────────

/**
 * Result of the sufficiency evaluation LLM call.
 *
 * Supports both legacy single-note creation (noteTitle/noteContent/noteTags)
 * and multi-note creation (notes[]) for decomposing syntheses into atomic chunks.
 */
export interface SufficiencyResult {
  sufficient: boolean;
  rationale: string;
  answer: string;
  /** When true, the answer is a novel synthesis worth saving as a new atomic note. */
  createNote?: boolean;
  /**
   * Multi-note output: decompose the synthesis into atomic notes.
   * Each note covers exactly one key idea.
   */
  notes?: Array<{
    title: string;
    content: string;
    tags: string[];
  }>;
  /** Title for the new atomic note, required when createNote is true (legacy single-note path). */
  noteTitle?: string;
  /** Markdown body for the new atomic note, required when createNote is true (legacy single-note path). */
  noteContent?: string;
  /** Tags for the new note's frontmatter, required when createNote is true (legacy single-note path). */
  noteTags?: string[];
  /** Optional commit message generated by the LLM for auto-commit to the knowledge base repo. */
  commitMessage?: string;
}

// ── Helpers ────────────────────────────────────────────────────────

/**
 * Run an LLM call directly without TUI components.
 *
 * Suitable for non-TUI modes (RPC, JSON, print) where there is no
 * BorderedLoader or done() callback available.
 *
 * @typeParam T - The parsed return type from the LLM response.
 * @param model - The LLM model to use.
 * @param auth - API key and headers for authentication.
 * @param systemPrompt - System prompt for the LLM.
 * @param messageContent - User message content array (type+text pairs).
 * @param parseFn - Function to parse the LLM response text into type T.
 * @param signal - Optional AbortSignal for cancellation.
 * @returns A promise resolving to an LlmCallResult.
 */
export async function callLlmDirect<T>(
  model: Parameters<typeof complete>[0],
  auth: { apiKey: string; headers?: Record<string, string> },
  systemPrompt: string,
  messageContent: { type: "text"; text: string }[],
  parseFn: (text: string) => T | null,
  signal?: AbortSignal,
): Promise<LlmCallResult<T>> {
  try {
    const userMessage: UserMessage = {
      role: "user",
      content: messageContent,
      timestamp: Date.now(),
    };
    const response = await complete(
      model,
      { systemPrompt, messages: [userMessage] },
      { apiKey: auth.apiKey, headers: auth.headers, signal },
    );
    if (response.stopReason === "aborted") {
      return { ok: false, type: "cancelled" };
    }
    const text = response.content
      .filter((c): c is { type: "text"; text: string } => c.type === "text")
      .map((c) => c.text)
      .join("\n");
    const parsed = parseFn(text);
    if (parsed === null) {
      return { ok: false, type: "error", message: "LLM returned invalid JSON" };
    }
    return { ok: true, value: parsed };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, type: "error", message };
  }
}

/**
 * Run an LLM call inside a BorderedLoader within a TUI custom context.
 *
 * @typeParam T - The parsed return type from the LLM response.
 * @param tui - TUI instance from the custom callback.
 * @param theme - Theme from the custom callback.
 * @param done - Done callback from the custom callback.
 * @param loaderText - Text to display in the loader.
 * @param model - The LLM model to use.
 * @param auth - API key and headers for authentication.
 * @param systemPrompt - System prompt for the LLM.
 * @param messageContent - User message content array (type+text pairs).
 * @param parseFn - Function to parse the LLM response text into type T.
 * @returns The BorderedLoader instance.
 */
export function callLlmWithLoader<T>(
  tui: unknown,
  theme: unknown,
  done: (value: LlmCallResult<T>) => void,
  loaderText: string,
  model: Parameters<typeof complete>[0],
  auth: { apiKey: string; headers?: Record<string, string> },
  systemPrompt: string,
  messageContent: { type: "text"; text: string }[],
  parseFn: (text: string) => T | null,
): BorderedLoader {
  const loader = new BorderedLoader(tui as never, theme as never, loaderText);
  loader.onAbort = () => done({ ok: false, type: "cancelled" });

  void (async () => {
    try {
      const userMessage: UserMessage = {
        role: "user",
        content: messageContent,
        timestamp: Date.now(),
      };
      const response = await complete(
        model,
        { systemPrompt, messages: [userMessage] },
        { apiKey: auth.apiKey, headers: auth.headers, signal: loader.signal },
      );
      if (response.stopReason === "aborted") {
        done({ ok: false, type: "cancelled" });
        return;
      }
      const text = response.content
        .filter((c): c is { type: "text"; text: string } => c.type === "text")
        .map((c) => c.text)
        .join("\n");
      const parsed = parseFn(text);
      if (parsed === null) {
        done({ ok: false, type: "error", message: "LLM returned invalid JSON" });
        return;
      }
      done({ ok: true, value: parsed });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      done({ ok: false, type: "error", message });
    }
  })();

  return loader;
}
