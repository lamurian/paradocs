/**
 * AI-based atomicity validation for PARA knowledge documents.
 *
 * Atomicity is measured by whether the content serves exactly one
 * question (implicit or explicit) and one answer that synthesizes
 * into one coherent topic. An LLM call evaluates this.
 *
 * If the content fails atomicity, the LLM decomposes it into
 * distinct Q&A pairs, each proposed as a separate atomic note.
 *
 * On LLM failure or cancellation, the check fails open (passes
 * content through) to avoid blocking document creation when the
 * LLM is unavailable.
 *
 * @module common/atomicity
 */


import { ATOMICITY_SYSTEM_PROMPT, BATCH_ATOMICITY_SYSTEM_PROMPT } from "./atomicity-prompts.js";
import { callLlmDirect } from "./llm.js";

import type { complete } from "@earendil-works/pi-ai";

// ── Types ─────────────────────────────────────────────────────────────

/**
 * Result of an atomicity check.
 *
 * When `valid` is false and `suggestedSplits` is present, the caller
 * should use the suggested splits as separate atomic notes instead.
 */
export interface AtomicityResult {
  /** Whether the content passes the atomicity principle. */
  valid: boolean;
  /** Human-readable message explaining the result. */
  message: string;
  /**
   * When valid=false, the decomposed atomic notes the agent should
   * create instead. Each entry has its own title, content, tags,
   * and an inferred PARA area.
   */
  suggestedSplits?: Array<{
    title: string;
    content: string;
    tags: string[];
    /** PARA area inferred by the LLM: Resources, Areas, or Projects. */
    area: string;
  }>;
}

/**
 * Optional context for the LLM call used by atomicity validation.
 */
export interface AtomicityContext {
  /** The LLM model to use for evaluation. */
  model?: Parameters<typeof complete>[0];
  /** API key for the LLM provider. */
  apiKey?: string;
  /** Optional AbortSignal for cancellation. */
  signal?: AbortSignal;
}

/**
 * A document to validate in batch mode.
 */
export interface BatchDoc {
  title: string;
  content: string;
  tags: string[];
}

// ── Constants ─────────────────────────────────────────────────────────

const DEFAULT_MODEL: Parameters<typeof complete>[0] = {
  id: "gpt-4o",
  provider: "openai",
  name: "gpt-4o",
  api: "openai-responses",
  baseUrl: "https://api.openai.com/v1",
  reasoning: false,
  input: ["text"],
  cost: { input: 2.5, output: 10, cacheRead: 1.25, cacheWrite: 2.5 },
  contextWindow: 128000,
  maxTokens: 16384,
};
const DEFAULT_API_KEY = "sk-placeholder";

// ── Helpers ─────────────────────────────────────────────────────────

/**
 * Build the user message content for an atomicity check.
 */
function buildAtomicityMessage(title: string, content: string): { type: "text"; text: string }[] {
  return [
    {
      type: "text" as const,
      text: `Title: ${title}\n\nContent:\n${content}`,
    },
  ];
}

/**
 * Build the user message for a batch atomicity check.
 */
function buildBatchAtomicityMessage(docs: BatchDoc[]): { type: "text"; text: string }[] {
  const docTexts = docs
    .map((d, i) => `[Document ${i + 1}]\nTitle: ${d.title}\nContent:\n${d.content}`)
    .join("\n\n---\n\n");

  return [
    {
      type: "text" as const,
      text: `Evaluate the following ${docs.length} document(s) for atomicity:\n\n${docTexts}`,
    },
  ];
}

// ── Main exports ─────────────────────────────────────────────────────

/**
 * Validate that markdown content satisfies the atomicity principle.
 *
 * Uses an LLM call to evaluate whether the content serves exactly
 * one question (implicit/explicit) and one answer. If not, the LLM
 * decomposes the content into suggested atomic note splits.
 *
 * On LLM failure or cancellation, the check fails open (returns
 * valid=true) to avoid blocking document creation.
 *
 * @param content - Markdown body content (without YAML frontmatter).
 * @param title   - Document title for context.
 * @param ctx     - Optional LLM context (model, apiKey, signal).
 * @returns A promise resolving to an {@link AtomicityResult}.
 */
export async function validateAtomicity(
  content: string,
  title: string,
  ctx?: AtomicityContext,
): Promise<AtomicityResult> {
  const model = ctx?.model ?? DEFAULT_MODEL;
  const apiKey = ctx?.apiKey ?? DEFAULT_API_KEY;

  const result = await callLlmDirect<AtomicityResult>(
    model,
    { apiKey },
    ATOMICITY_SYSTEM_PROMPT,
    buildAtomicityMessage(title, content),
    (text) => {
      try {
        const parsed = JSON.parse(text) as AtomicityResult;
        if (typeof parsed.valid === "boolean" && typeof parsed.message === "string") {
          return parsed;
        }
        return null;
      } catch {
        return null;
      }
    },
    ctx?.signal,
  );

  if (!result.ok) {
    if (result.type === "cancelled") {
      return { valid: true, message: "LLM check cancelled — content accepted." };
    }
    return {
      valid: true,
      message: `LLM check unavailable (${result.message}) — content accepted.`,
    };
  }

  return result.value;
}

/**
 * Validate multiple documents for atomicity in a single LLM call.
 *
 * More efficient than calling {@link validateAtomicity} N times since
 * the LLM evaluates all documents at once.
 *
 * On LLM failure, all documents fail open (return valid=true).
 *
 * @param docs - Array of documents to validate.
 * @param ctx  - Optional LLM context (model, apiKey, signal).
 * @returns A promise resolving to an array of {@link AtomicityResult},
 *          one per document in the same order.
 */
export async function validateDocumentsAtomicity(
  docs: BatchDoc[],
  ctx?: AtomicityContext,
): Promise<AtomicityResult[]> {
  if (docs.length === 0) return [];

  const model = ctx?.model ?? DEFAULT_MODEL;
  const apiKey = ctx?.apiKey ?? DEFAULT_API_KEY;

  const result = await callLlmDirect<AtomicityResult[]>(
    model,
    { apiKey },
    BATCH_ATOMICITY_SYSTEM_PROMPT,
    buildBatchAtomicityMessage(docs),
    (text) => {
      try {
        const parsed: unknown = JSON.parse(text);
        if (Array.isArray(parsed)) {
          const valid = parsed.every(
            (r: unknown) =>
              typeof (r as AtomicityResult).valid === "boolean" &&
              typeof (r as AtomicityResult).message === "string",
          );
          if (valid) return parsed as AtomicityResult[];
        }
        return null;
      } catch {
        return null;
      }
    },
    ctx?.signal,
  );

  if (!result.ok) {
    // Fail-open: all docs pass
    return docs.map(() => ({
      valid: true,
      message: "LLM check unavailable — content accepted.",
    }));
  }

  // Validate the response has the right length
  if (result.value.length !== docs.length) {
    return docs.map(() => ({
      valid: false,
      message: `Unexpected response length: expected ${docs.length}, got ${result.value.length}.`,
    }));
  }

  return result.value;
}
