/**
 * Shared types for the research engine archetype.
 *
 * @module extensions/research-engine/types
 */

import type { CreateAgentSessionOptions } from "@earendil-works/pi-coding-agent";

/** Runtime model object handed down by pi (used for atomicity subagents). */
export type RuntimeModel = NonNullable<CreateAgentSessionOptions["model"]>;

/** Minimal model identity for subagent CLI flags (--provider/--model). */
export interface SubagentModel {
  provider: string;
  modelId: string;
}

/**
 * Derive subagent CLI identity from a runtime model object.
 *
 * @param model - Runtime model from the extension context.
 * @returns Provider name and model id for --provider/--model flags.
 */
export function toSubagentModel(model: RuntimeModel): SubagentModel {
  return { provider: model.provider, modelId: model.id };
}

/** A single web source collected by the research engine. */
export interface ResearchSource {
  /** Source URL. */
  url: string;
  /** Key points from the source relevant to the research question. */
  snippet: string;
  /** Optional source title. */
  title?: string;
  /** Optional authors ("Last, First" format) for citation fallback metadata. */
  authors?: string[];
  /** Optional publication year for citation fallback metadata. */
  year?: number;
  /** Optional search tier the source was found in (1-3). */
  tier?: number;
}

/** An existing knowledge base note detected as outdated. */
export interface OutdatedNote {
  /** Note path relative to KNOWLEDGE_DIR, e.g. "Resources/foo.md". */
  path: string;
  /** Why the note is considered outdated. */
  reason: string;
}

/** Sufficiency and freshness assessment of existing knowledge base docs. */
export interface SufficiencyResult {
  /** True when existing docs fully and freshly answer the question. */
  sufficient: boolean;
  /** Existing notes detected as outdated. */
  outdatedNotes: OutdatedNote[];
  /** Unanswered aspects when insufficient. */
  gaps: string[];
}

/** Merged result of one research engine run across all questions. */
export interface ResearchResult {
  /** Deduplicated sources collected across all questions. */
  sources: ResearchSource[];
  /** The research questions that were executed. */
  questions: string[];
  /** Assessment of existing knowledge base coverage. */
  assessment: SufficiencyResult;
}

/** Validated JSON contract returned by the search subagent. */
export interface SearchSubagentValue {
  /** Suitable sources with url + snippet (title/tier optional). */
  sources: Array<{ url: string; title?: string; snippet: string; tier?: number }>;
  /** Facets of the question the collected sources address. */
  coveredFacets: string[];
}

/** Outcome of writing research results back to the knowledge base. */
export interface WritebackResult {
  /** Paths of newly created notes (relative to KNOWLEDGE_DIR). */
  created: string[];
  /** Paths of outdated notes that were updated (relative to KNOWLEDGE_DIR). */
  updated: string[];
  /** Sources or notes that were skipped, with reasons. */
  skipped: string[];
}
