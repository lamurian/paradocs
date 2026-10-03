/**
 * FSM event union and terminal-stage set for the research pipeline.
 *
 * @module extensions/research-engine/events
 */

import type {
  Candidate,
  DecisionRecord,
  FailureRecord,
  FetchRecord,
  GateProfile,
  JudgeResult,
  KbDocGist,
  ResearchStage,
  StructuralResult,
  SummaryItem,
} from "./state.js";

/** Discriminated union of all FSM events. */
export type ResearchEvent =
  | {
      type: "start";
      question: string;
      mode: "breadth" | "depth";
      profile: GateProfile;
      jobId: string;
      startedAt: number;
      seed?: { visited?: string[]; summaries?: SummaryItem[]; askedQuestions?: string[] };
    }
  | {
      type: "queries_generated";
      queries: string[];
      kbDocs: KbDocGist[];
      kbSufficient: boolean | null;
      kbFreshRatio: number | null;
      llmErrors?: number;
    }
  | { type: "search_done"; candidates: Candidate[] }
  | { type: "ranked"; candidates: Candidate[]; llmErrors?: number }
  | { type: "fetched"; records: FetchRecord[] }
  | { type: "summarized"; items: SummaryItem[]; llmErrors?: number; failures?: FailureRecord[] }
  | {
      type: "assessed";
      structural: StructuralResult;
      judge?: JudgeResult | null;
      escalation?: DecisionRecord;
      llmErrors?: number;
    }
  | { type: "refined"; questions: string[]; coveredFacets: string[]; llmErrors?: number }
  | { type: "synthesized"; synthesis: string; error?: string; llmErrors?: number }
  | {
      type: "writeback_done";
      writeback: { created: string[]; updated: string[]; skipped: string[] };
    }
  | { type: "escalated"; decision: DecisionRecord }
  | { type: "aborted" };

/** Stages that accept no further events. */
export const TERMINAL_STAGES: ReadonlySet<ResearchStage> = new Set([
  "DONE_SUFFICIENT",
  "DONE_DEGRADED",
  "DONE_FAILED",
  "ESCALATED",
  "CANCELLED",
]);
