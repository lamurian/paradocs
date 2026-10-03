/**
 * Research pipeline dependency surface and progress messages.
 *
 * `ResearchDeps` is the injected I/O surface the orchestrator needs;
 * commands, tools, and tests provide their own implementations.
 *
 * @module extensions/research-engine/research-deps
 */

import type { SearchDeps } from "./search.js";
import type { ResearchStage, WritebackLite } from "./state.js";
import type { ResearchSource } from "./types.js";
/** Input for one orchestrator-issued LLM call. */
export interface LlmCallInput {
  system: string;
  user: string;
  parse: (text: string) => unknown;
  timeoutMs?: number;
  /** Short TUI loader label for this call. */
  label?: string;
}

/** Normalized LLM call outcome (never throws). */
export interface LlmCallOutcome {
  ok: boolean;
  value?: unknown;
  error?: string;
}

/** Knowledge-base document gist returned by the KB search. */
export interface KbDocWithTitle {
  title: string;
  path: string;
  created?: string;
}

/** Injected I/O surface for the research orchestrator. */
export interface ResearchDeps {
  /** Direct LLM call with a strict parser (never throws). */
  llm: (input: LlmCallInput) => Promise<LlmCallOutcome>;
  /** In-process KB search (returns title/path/date gists). */
  searchDocs: (query: string) => Promise<KbDocWithTitle[]>;
  /** URL fetch with timeout (content + error, mirroring fetchUrlWithTimeout). */
  fetchUrl: (
    url: string,
    timeoutMs: number,
    signal?: AbortSignal,
  ) => Promise<{ title?: string; content?: string; error?: string }>;
  /** KB write-back adapter (sources carry citation metadata). */
  writeBack: (input: { sources: ResearchSource[]; questions: string[] }) => Promise<WritebackLite>;
  /** Resolved KNOWLEDGE_DIR for checkpoints. */
  knowledgeDir: string;
  now?: () => number;
  onProgress?: (stage: ResearchStage, message: string) => void;
  appendEntry?: (customType: string, data: unknown) => void;
  notify?: (message: string) => void;
  signal?: AbortSignal;
  /** Enables the deterministic escalation decision (ask tool quick mode). */
  allowEscalation?: boolean;
  /** Search backend override (tests). */
  searchDeps?: SearchDeps;
  fetchConcurrency?: number;
  fetchTimeoutMs?: number;
  llmTimeoutMs?: number;
}

/** Per-stage progress messages surfaced in TUI/RPC. */
export const DEFAULT_STAGE_MESSAGES: Record<ResearchStage, string> = {
  IDLE: "starting…",
  QUERY_GEN: "querying…",
  SEARCH: "searching…",
  RANK: "ranking…",
  FETCH: "fetching…",
  SUMMARIZE: "summarizing…",
  ASSESS: "assessing…",
  REFINE: "refining…",
  SYNTHESIZE: "synthesizing…",
  WRITE_BACK: "writing back…",
  DONE_SUFFICIENT: "done",
  DONE_DEGRADED: "done (degraded)",
  DONE_FAILED: "failed",
  ESCALATED: "escalated",
  CANCELLED: "cancelled",
};
