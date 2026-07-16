/**
 * Shared LLM utilities for the coding agent.
 *
 * Provides:
 * - `callLlmDirect<T>()` — direct LLM call without TUI dependencies
 *
 * @module common/llm
 */

import { complete, type UserMessage } from "@earendil-works/pi-ai";

// ── Types ─────────────────────────────────────────────────────────────

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

// ── Exports ──────────────────────────────────────────────────────────

/**
 * Run an LLM call directly without TUI components.
 *
 * Suitable for non-TUI modes (RPC, JSON, print) and for tools that
 * need LLM access without a BorderedLoader.
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
