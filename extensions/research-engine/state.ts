/**
 * Research state, shared types, and checkpoint persistence.
 *
 * The FSM pipeline keeps all progress in a plain `ResearchState` object
 * (code state — immune to context compaction). After every transition the
 * orchestrator checkpoints `{ state, lastTransition }` to
 * `KNOWLEDGE_DIR/.research/<jobId>.json` so runs survive process death and
 * can be inspected or resumed.
 *
 * @module extensions/research-engine/state
 */

// ── Stage & event data types ──────────────────────────────────────────

/** FSM stage names. Terminal stages accept no further events. */
export type ResearchStage =
  | "IDLE"
  | "QUERY_GEN"
  | "SEARCH"
  | "RANK"
  | "FETCH"
  | "SUMMARIZE"
  | "ASSESS"
  | "REFINE"
  | "SYNTHESIZE"
  | "WRITE_BACK"
  | "DONE_SUFFICIENT"
  | "DONE_DEGRADED"
  | "DONE_FAILED"
  | "ESCALATED"
  | "CANCELLED";

/** One knowledge-base document gist used for KB-first decisions. */
export interface KbDocGist {
  title: string;
  path: string;
  /** ISO date string from the doc frontmatter, when present. */
  date?: string;
}

/** A search candidate produced by the SEARCH stage. */
export interface Candidate {
  url: string;
  canonicalUrl: string;
  title?: string;
  snippet?: string;
  /** Search tier that produced the candidate (1 academic, 2 edu/gov, 3 web). */
  tier: number;
  query: string;
}

/** Deterministic metadata + content fetched for one URL. */
export interface FetchRecord {
  url: string;
  canonicalUrl: string;
  ok: boolean;
  content?: string;
  title?: string;
  authors?: string[];
  year?: number;
  tier?: number;
  error?: string;
  fetchedAt: number;
  durationMs?: number;
}

/** A per-source summary produced by the SUMMARIZE stage. */
export interface SummaryItem {
  url: string;
  canonicalUrl: string;
  summary: string;
  title?: string;
  truncation?: "head_tail";
}

/** Per-cycle record kept for the digest and loop bookkeeping. */
export interface CycleRecord {
  cycle: number;
  questions: string[];
  candidates: number;
  fetched: number;
  summarized: number;
}

/** A typed pipeline failure (never swallowed). */
export interface FailureRecord {
  stage: string;
  error: string;
  url?: string;
}

/** Write-back outcome summary. */
export interface WritebackLite {
  created: string[];
  updated: string[];
  skipped: string[];
}

/** One FSM transition, appended to the event-sourced trace. */
export interface TransitionRecord {
  ts: number;
  from: ResearchStage;
  event: string;
  to: ResearchStage;
}

/** Budgets shared by stop-criteria checks. */
export interface ResearchBudgets {
  targetSources: number;
  maxCycles: number;
  deadlineMs: number;
}

/** Full per-command profile: budgets plus sufficiency gate settings. */
export interface GateProfile extends ResearchBudgets {
  name: string;
  minDomains: number;
  requireAuthoritative: boolean;
  /** Freshness window in days; null disables the FRESHNESS gate. */
  freshnessWindowDays: number | null;
}

/** Deterministic escalation decision recorded at ASSESS. */
export interface DecisionRecord {
  from: "ASSESS";
  escalate: boolean;
  /** Human-readable reason incl. detail, e.g. "THIN_CANDIDATES (6<8 candidates)". */
  reason: string;
  guards: Record<string, unknown>;
}

/** Result of one structural sufficiency gate. */
export interface GateResult {
  code: "SOURCES" | "DOMAINS" | "AUTHORITY" | "FRESHNESS";
  status: "pass" | "fail" | "indeterminate";
  detail: string;
}

/** Layer-1 (LLM-free) sufficiency evaluation. */
export interface StructuralResult {
  pass: boolean;
  gates: GateResult[];
  failed: string[];
  indeterminate: string[];
}

/** Layer-2 judge verdict (validated LLM output). */
export interface JudgeResult {
  sufficient: boolean;
  gaps: string[];
  error?: string;
}

/** Digest of research progress for tool results and appendEntry mirrors. */
export interface ResearchDigest {
  jobId: string;
  question: string;
  sourceCount: number;
  questionsByCycle: string[][];
  gaps: string[];
  failures: FailureRecord[];
  terminalStage: ResearchStage;
}

/** Full persisted research state. */
export interface ResearchState {
  jobId: string;
  question: string;
  mode: "breadth" | "depth";
  profile: GateProfile;
  stage: ResearchStage;
  cycle: number;
  startedAt: number;
  deadlineAt: number;
  queries: string[];
  kbDocs: KbDocGist[];
  kbSufficient: boolean | null;
  kbFreshRatio: number | null;
  kbCovered: boolean;
  candidates: Candidate[];
  lastRankCount: number;
  fetches: FetchRecord[];
  summaries: SummaryItem[];
  visited: string[];
  askedQuestions: string[];
  coveredFacets: string[];
  gaps: string[];
  cycles: CycleRecord[];
  failures: FailureRecord[];
  llmErrorCount: number;
  deadlineHit: boolean;
  degraded: boolean;
  synthesis?: string;
  synthesisError?: string;
  writeback?: WritebackLite;
  escalation?: DecisionRecord;
  trace: TransitionRecord[];
}

/** On-disk checkpoint shape. */
export interface CheckpointFile {
  state: ResearchState;
  lastTransition: TransitionRecord | null;
}

/** Stage-bound effect descriptors returned by transitions (executed by the runner). */
export type Effect =
  | { kind: "checkpoint" }
  | { kind: "query_gen"; questions?: string[] }
  | { kind: "search" }
  | { kind: "rank" }
  | { kind: "fetch"; urls: string[] }
  | { kind: "assess" }
  | {
      kind: "summarize";
      url: string;
      canonicalUrl: string;
      mode: "whole" | "head_tail";
      text: string;
      truncation?: "head_tail";
    }
  | {
      kind: "summarize_chunk";
      url: string;
      canonicalUrl: string;
      index: number;
      chunkCount: number;
      text: string;
    }
  | { kind: "summarize_merge"; url: string; canonicalUrl: string; chunkCount: number }
  | { kind: "refine" }
  | { kind: "synthesize"; degraded?: boolean; source?: "web" | "kb" }
  | { kind: "writeback" }
  | { kind: "append_entry"; customType: string; data: unknown }
  | { kind: "notify"; message: string };

// ── Digest ────────────────────────────────────────────────────────────

/**
 * Build a compact progress digest for tool results and session entries.
 *
 * @param state - The research state to summarize.
 * @returns Digest with per-cycle questions, source count, and gaps.
 */
export function buildDigest(state: ResearchState): ResearchDigest {
  return {
    jobId: state.jobId,
    question: state.question,
    sourceCount: state.summaries.length,
    questionsByCycle: state.cycles.map((c) => c.questions),
    gaps: state.gaps,
    failures: state.failures,
    terminalStage: state.stage,
  };
}
