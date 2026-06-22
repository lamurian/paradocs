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

Return ONLY a JSON object with this exact structure:
{
  "sufficient": true,
  "rationale": "Brief explanation of the assessment",
  "answer": "If sufficient, a comprehensive answer synthesising the existing documents with @citekey citations. Empty string if insufficient."
}

Evaluate carefully:
- sufficient=true only if the documents collectively provide a complete, well-sourced answer
- sufficient=false if major gaps exist, sources are weak, or the topic is only partially covered
- In the answer, cite sources using @citekey notation from the document content`;

// ── Types ──────────────────────────────────────────────────────────

/** Result of the sufficiency evaluation LLM call. */
export interface SufficiencyResult {
  sufficient: boolean;
  rationale: string;
  answer: string;
}

// ── Helpers ────────────────────────────────────────────────────────

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
  done: (value: T | null) => void,
  loaderText: string,
  model: Parameters<typeof complete>[0],
  auth: { apiKey: string; headers?: Record<string, string> },
  systemPrompt: string,
  messageContent: { type: "text"; text: string }[],
  parseFn: (text: string) => T | null,
): BorderedLoader {
  const loader = new BorderedLoader(tui as never, theme as never, loaderText);
  loader.onAbort = () => done(null);

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
        done(null);
        return;
      }
      const text = response.content
        .filter((c): c is { type: "text"; text: string } => c.type === "text")
        .map((c) => c.text)
        .join("\n");
      done(parseFn(text));
    } catch {
      done(null);
    }
  })();

  return loader;
}
