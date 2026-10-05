/**
 * Draft-note writer: dumps research material when KB grouping fails.
 *
 * When the grouping subagent fails after a retry, the collected sources
 * (with resolved citekeys) and any synthesis text are written to
 * `KNOWLEDGE_DIR/.research/drafts/<jobId>.md` so nothing is discarded.
 *
 * @module extensions/research-engine/draft
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import type { ResearchSource } from "./types.js";

/** Subdirectory under KNOWLEDGE_DIR holding draft notes. */
export const DRAFT_SUBDIR = ".research/drafts";

/** Input for one draft note. */
export interface DraftInput {
  jobId: string;
  question?: string;
  sources: ResearchSource[];
  /** URL → resolved citekey from the citation resolution pass. */
  citekeys: Map<string, string>;
  synthesis?: string;
}

/**
 * Resolve the draft note path for a job.
 *
 * @param knowledgeDir - KNOWLEDGE_DIR resolved from env config.
 * @param jobId - Research job identifier.
 * @returns Absolute path of the draft note.
 */
export function draftPathFor(knowledgeDir: string, jobId: string): string {
  return join(knowledgeDir, DRAFT_SUBDIR, `${jobId}.md`);
}

/**
 * Write a draft note with sources, citekeys, and synthesis.
 *
 * @param knowledgeDir - KNOWLEDGE_DIR resolved from env config.
 * @param input - Sources, citekeys, optional question/synthesis.
 * @returns The absolute path of the written draft note.
 */
export function writeDraftNote(knowledgeDir: string, input: DraftInput): string {
  const path = draftPathFor(knowledgeDir, input.jobId);
  mkdirSync(dirname(path), { recursive: true });
  const lines: string[] = [];
  lines.push(`# Research draft: ${input.question ?? input.jobId}`, "");
  lines.push("> Auto-drafted when the knowledge-base grouping step failed.");
  lines.push("> Sources and citations are preserved for manual processing.", "");
  if (input.synthesis && input.synthesis.trim().length > 0) {
    lines.push("## Synthesis", "", input.synthesis, "");
  }
  lines.push("## Sources", "");
  for (const s of input.sources) {
    const key = input.citekeys.get(s.url);
    const cite = key ? ` (@${key})` : "";
    lines.push(`- ${s.url}${s.title ? ` — ${s.title}` : ""}${cite}`);
    if (s.snippet && s.snippet.trim().length > 0) lines.push(`  ${s.snippet}`);
  }
  lines.push("");
  writeFileSync(path, lines.join("\n"), "utf-8");
  return path;
}
