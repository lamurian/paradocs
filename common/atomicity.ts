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
 * On sub-agent creation failure (infrastructure issue), fails closed
 * (rejects). On JSON parse error (LLM produced non-JSON), fails open
 * (accepts) to avoid blocking document creation.
 *
 * @module common/atomicity
 */

import {
  AuthStorage,
  createAgentSession,
  type CreateAgentSessionOptions,
  ModelRegistry,
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

/**
 * Spawn an ephemeral sub-agent to evaluate atomicity.
 *
 * Creates a minimal session using the default ResourceLoader (no custom
 * extensions or skills needed), then immediately sets the system prompt
 * on the agent state. This avoids file I/O dependencies from
 * DefaultResourceLoader configuration.
 *
 * The sub-agent receives the document title and content as a user
 * message and returns JSON via text deltas in the event stream.
 *
 * @param model   - The LLM model to use (inherited from parent).
 * @param userMessage - The message to send (title + content).
 * @returns The accumulated response text, or null on failure.
 */
async function spawnAtomicitySubAgent(model: Model, userMessage: string): Promise<string | null> {
  const authStorage = AuthStorage.create();
  const modelRegistry = ModelRegistry.create(authStorage);

  let session;
  try {
    const result = await createAgentSession({
      sessionManager: SessionManager.inMemory(),
      model,
      noTools: "all",
      authStorage,
      modelRegistry,
    });
    session = result.session;
  } catch {
    return null;
  }

  try {
    // Set the system prompt directly on the agent state.
    // This is the simplest way to override the prompt without a
    // custom ResourceLoader.
    session.agent.state.systemPrompt = ATOMICITY_SYSTEM_PROMPT;

    let fullText = "";
    const unsubscribe = session.subscribe((event) => {
      if (event.type === "message_update" && event.assistantMessageEvent?.type === "text_delta") {
        fullText += event.assistantMessageEvent.delta;
      }
    });

    await session.prompt(userMessage);
    unsubscribe();
    return fullText || null;
  } catch {
    return null;
  } finally {
    session.dispose();
  }
}

// ── Main exports ─────────────────────────────────────────────────────

/**
 * Validate that markdown content satisfies the atomicity principle.
 *
 * Spawns a minimal sub-agent to evaluate whether the content serves
 * exactly one question (implicit/explicit) and one answer. If not,
 * the sub-agent decomposes the content into suggested atomic splits.
 *
 * Fails closed on sub-agent creation failure (infrastructure issue).
 * Fails open on JSON parse error (LLM produced unparseable output).
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
  const response = await spawnAtomicitySubAgent(model, userMessage);

  if (response === null) {
    return {
      valid: false,
      message: "Sub-agent unavailable — atomicity check could not run.",
    };
  }

  const result = parseAtomicityResult(response);
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
 * Fails closed on sub-agent creation failure (infrastructure issue).
 * Fails open on JSON parse error (unparseable output).
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
  const response = await spawnAtomicitySubAgent(model, userMessage);

  if (response === null) {
    return docs.map(() => ({
      valid: false,
      message: "Sub-agent unavailable — atomicity check could not run.",
    }));
  }

  const results = parseAtomicityResultsArray(response, docs.length);
  if (results === null) {
    return docs.map(() => ({
      valid: true,
      message: "Atomicity check could not be parsed — content accepted.",
    }));
  }

  return results;
}
