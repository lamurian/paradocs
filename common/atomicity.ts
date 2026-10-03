/**
 * Sub-agent atomicity validation for PARA knowledge documents.
 *
 * Spawns an ephemeral pi sub-agent via createAgentSession() to evaluate
 * whether content serves exactly one question (implicit or explicit)
 * and one answer on a single coherent topic.
 *
 * The sub-agent is created with the default ResourceLoader and its system
 * prompt is set directly on session.agent.state to avoid file I/O from
 * custom ResourceLoader configuration.
 *
 * On sub-agent failure (infrastructure issue), retries once and then
 * fails open: content is accepted with an "atomicity unverified" warning
 * that carries the underlying error. On JSON parse error (LLM produced
 * non-JSON), fails open (accepts) to avoid blocking document creation.
 *
 * @module common/atomicity
 */

import {
  createAgentSession,
  type CreateAgentSessionOptions,
  SessionManager,
} from "@earendil-works/pi-coding-agent";

import { parseAtomicityResult, parseAtomicityResultsArray } from "./atomicity-parse.js";
import { ATOMICITY_SYSTEM_PROMPT } from "./atomicity-prompts.js";

/** Model type used by pi SDK for LLM configuration. */
type Model = NonNullable<CreateAgentSessionOptions["model"]>;

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
   * Set when the atomicity check could not run (sub-agent unavailable
   * after retry). Content is accepted (fail-open) but unverified.
   */
  warning?: string;
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
 * A document to validate in batch mode.
 */
export interface BatchDoc {
  title: string;
  content: string;
  tags: string[];
}

// ── Sub-agent helper ────────────────────────────────────────────────

/** Outcome of one sub-agent attempt. */
interface SubAgentOutcome {
  ok: boolean;
  text?: string;
  error?: string;
}

/**
 * Spawn an ephemeral sub-agent to evaluate atomicity (single attempt).
 *
 * Creates a minimal session using the default ResourceLoader, sets the
 * system prompt directly on the agent state, and returns the accumulated
 * response text. Failures return a typed error instead of throwing.
 *
 * @param model   - The LLM model to use (inherited from parent).
 * @param userMessage - The message to send (title + content).
 * @returns Outcome with response text, or a typed error.
 */
async function spawnAtomicitySubAgent(model: Model, userMessage: string): Promise<SubAgentOutcome> {
  let session;
  try {
    const result = await createAgentSession({
      sessionManager: SessionManager.inMemory(),
      model,
      noTools: "all",
    });
    session = result.session;
  } catch (e: unknown) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }

  try {
    session.agent.state.systemPrompt = ATOMICITY_SYSTEM_PROMPT;

    let fullText = "";
    const unsubscribe = session.subscribe((event) => {
      if (event.type === "message_update" && event.assistantMessageEvent?.type === "text_delta") {
        fullText += event.assistantMessageEvent.delta;
      }
    });

    await session.prompt(userMessage);
    unsubscribe();
    return fullText
      ? { ok: true, text: fullText }
      : { ok: false, error: "empty sub-agent response" };
  } catch (e: unknown) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  } finally {
    session.dispose();
  }
}

/**
 * Run the sub-agent with one retry; on total failure produce the
 * fail-open "atomicity unverified" result carrying the real error.
 *
 * @param model - The LLM model to use.
 * @param userMessage - The message to send.
 * @returns Response text, or the fail-open warning result.
 */
async function runWithRetry(
  model: Model,
  userMessage: string,
): Promise<{ text: string } | { unverified: AtomicityResult }> {
  const first = await spawnAtomicitySubAgent(model, userMessage);
  if (first.ok && first.text !== undefined) return { text: first.text };
  const retry = await spawnAtomicitySubAgent(model, userMessage);
  if (retry.ok && retry.text !== undefined) return { text: retry.text };
  const err = retry.error ?? first.error ?? "unknown error";
  return {
    unverified: {
      valid: true,
      message: `atomicity unverified: ${err}`,
      warning: `atomicity unverified: ${err}`,
    },
  };
}

// ── Main exports ─────────────────────────────────────────────────────

/**
 * Validate that markdown content satisfies the atomicity principle.
 *
 * Spawns a minimal sub-agent to evaluate whether the content serves
 * exactly one question (implicit/explicit) and one answer. If not,
 * the sub-agent decomposes the content into suggested atomic splits.
 *
 * Fails open with an "atomicity unverified" warning (after one retry)
 * when the sub-agent is unavailable. Fails open on JSON parse error
 * (LLM produced unparseable output).
 *
 * @param content - Markdown body content (without YAML frontmatter).
 * @param title   - Document title for context.
 * @param model   - The LLM model to use (from parent session).
 * @param options - Optional settings (e.g., abort signal).
 * @returns A promise resolving to an {@link AtomicityResult}.
 */
export async function validateAtomicity(
  content: string,
  title: string,
  model: Model,
  options?: { signal?: AbortSignal },
): Promise<AtomicityResult> {
  if (options?.signal?.aborted) {
    return { valid: true, message: "Atomicity check cancelled — content accepted." };
  }

  const userMessage = `Title: ${title}\n\nContent:\n${content}`;
  const outcome = await runWithRetry(model, userMessage);
  if ("unverified" in outcome) return outcome.unverified;

  const result = parseAtomicityResult(outcome.text);
  if (result === null) {
    return {
      valid: true,
      message: "Atomicity check could not be parsed — content accepted.",
    };
  }

  return result;
}

/**
 * Validate multiple documents for atomicity in a single sub-agent call.
 *
 * The sub-agent evaluates all documents at once and returns an array
 * of per-document results.
 *
 * Fails open with per-doc "atomicity unverified" warnings (after one
 * retry) when the sub-agent is unavailable. Fails open on JSON parse
 * error (unparseable output).
 *
 * @param docs  - Array of documents to validate.
 * @param model - The LLM model to use (from parent session).
 * @returns A promise resolving to an array of {@link AtomicityResult},
 *          one per document in the same order.
 */
export async function validateDocumentsAtomicity(
  docs: BatchDoc[],
  model: Model,
): Promise<AtomicityResult[]> {
  if (docs.length === 0) return [];

  const docTexts = docs
    .map((d, i) => `[Document ${i + 1}]\nTitle: ${d.title}\nContent:\n${d.content}`)
    .join("\n\n---\n\n");

  const userMessage = `Evaluate the following ${docs.length} document(s) for atomicity:\n\n${docTexts}`;
  const outcome = await runWithRetry(model, userMessage);
  if ("unverified" in outcome) {
    return docs.map(() => ({ ...outcome.unverified }));
  }

  const results = parseAtomicityResultsArray(outcome.text, docs.length);
  if (results === null) {
    return docs.map(() => ({
      valid: true,
      message: "Atomicity check could not be parsed — content accepted.",
    }));
  }

  return results;
}
