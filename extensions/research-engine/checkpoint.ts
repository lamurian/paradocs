/**
 * Checkpoint persistence for research state.
 *
 * After every FSM transition the runner writes `{ state, lastTransition }`
 * to `KNOWLEDGE_DIR/.research/<jobId>.json` so runs survive process death
 * and can be inspected or resumed.
 *
 * @module extensions/research-engine/checkpoint
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { CheckpointFile, ResearchState } from "./state.js";

/** Subdirectory under KNOWLEDGE_DIR holding research checkpoints. */
export const RESEARCH_STATE_SUBDIR = ".research";

/**
 * Resolve the research state directory for a knowledge dir.
 *
 * @param knowledgeDir - Resolved KNOWLEDGE_DIR path.
 * @returns Path to the `.research` checkpoint subdirectory.
 */
export function researchStateDir(knowledgeDir: string): string {
  return join(knowledgeDir, RESEARCH_STATE_SUBDIR);
}

/**
 * Resolve the checkpoint file path for a job.
 *
 * @param knowledgeDir - Resolved KNOWLEDGE_DIR path.
 * @param jobId - Research job identifier.
 * @returns Absolute path to the job checkpoint JSON file.
 */
export function checkpointPathFor(knowledgeDir: string, jobId: string): string {
  return join(researchStateDir(knowledgeDir), `${jobId}.json`);
}

/**
 * Persist a state checkpoint (state + last transition).
 *
 * @param knowledgeDir - Resolved KNOWLEDGE_DIR path.
 * @param state - The research state to persist.
 * @returns The checkpoint file path that was written.
 */
export function saveCheckpoint(knowledgeDir: string, state: ResearchState): string {
  const dir = researchStateDir(knowledgeDir);
  mkdirSync(dir, { recursive: true });
  const path = checkpointPathFor(knowledgeDir, state.jobId);
  const payload: CheckpointFile = {
    state,
    lastTransition: state.trace.length > 0 ? state.trace[state.trace.length - 1] : null,
  };
  writeFileSync(path, JSON.stringify(payload, null, 2), "utf-8");
  return path;
}

/**
 * Load a checkpoint from disk.
 *
 * @param path - Checkpoint file path.
 * @returns Parsed checkpoint, or null when missing/corrupt.
 */
export function loadCheckpoint(path: string): CheckpointFile | null {
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf-8")) as CheckpointFile;
    if (!parsed || typeof parsed !== "object" || !parsed.state) return null;
    return parsed;
  } catch {
    return null;
  }
}
