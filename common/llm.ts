/**
 * Shared LLM utilities for the coding agent.
 *
 * Provides:
 * - `callLlmDirect<T>()` — direct LLM call without TUI dependencies
 * - `parseJsonResponse<T>()` — strips markdown fences and parses JSON
 *
 * The TUI-specific `callLlmWithLoader` stays in the command layer
 * because it depends on `BorderedLoader` from `@earendil-works/pi-coding-agent`.
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

// ── Helpers ──────────────────────────────────────────────────────────

/**
 * Strip markdown code fences from an LLM response and parse as JSON.
 *
 * LLMs sometimes wrap JSON output in ```json ... ``` fences.
 * This handles that common case gracefully.
 *
 * @typeParam T - The expected parsed type.
 * @param text - The raw text from the LLM response.
 * @returns Parsed object, or `null` if parsing fails.
 */
export function parseJsonResponse<T>(text: string): T | null {
  const trimmed = text.trim();

  // Try parsing as-is first (most common when properly instructed)
  try {
    return JSON.parse(trimmed) as T;
  } catch {
    // Fall through to fence stripping
  }

  // Strip markdown code fences
  // Matches ```json ... ```, ``` ... ```, or ```...\n...```
  const fenceMatch = trimmed.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```\s*$/);
  if (fenceMatch) {
    try {
      return JSON.parse(fenceMatch[1].trim()) as T;
    } catch {
      return null;
    }
  }

  // Try to find JSON object/array in the text (for cases with leading/trailing prose)
  const jsonMatch = trimmed.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
  if (jsonMatch) {
    try {
      return JSON.parse(jsonMatch[1]) as T;
    } catch {
      return null;
    }
  }

  return null;
}

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
