/**
 * Shared renderer helpers for research results.
 *
 * Deterministic synthesis fallback chain: synthesis text → joined
 * summaries → KB doc titles/paths + fetched source titles/URLs.
 * Research material is never discarded, and no emojis are emitted.
 *
 * @module extensions/research-engine/render
 */

import type { ResearchState, WritebackLite } from "./state.js";

/** Minimal state slice the renderers need. */
export type RenderableState = Pick<
  ResearchState,
  "synthesis" | "synthesisError" | "summaries" | "kbDocs" | "fetches"
>;

/**
 * Render the answer body with the deterministic fallback chain.
 *
 * @param state - Terminal research state slice.
 * @returns Synthesis text, or the fallback body plus the unavailable note.
 */
export function renderAnswerBody(state: RenderableState): string {
  if (state.synthesis && state.synthesis.trim().length > 0) return state.synthesis;
  const note = `_(synthesis unavailable: ${state.synthesisError ?? "no sources collected"})_`;
  if (state.summaries.length > 0) {
    const body = state.summaries
      .map((s) => `- ${s.url}${s.title ? ` (${s.title})` : ""}: ${s.summary}`)
      .join("\n");
    return `${body}\n\n${note}`;
  }
  const lines: string[] = [];
  for (const d of state.kbDocs) lines.push(`- KB: ${d.title} (${d.path})`);
  for (const f of state.fetches.filter((r) => r.ok)) {
    lines.push(`- ${f.url}${f.title ? ` (${f.title})` : ""}`);
  }
  return `${lines.join("\n")}\n\n${note}`;
}

/**
 * Render write-back status lines (created/updated/skipped incl. drafts).
 *
 * @param wb - Write-back outcome, or undefined when not run.
 * @returns One line per outcome entry.
 */
export function renderWritebackLines(wb: WritebackLite | undefined): string[] {
  if (!wb) return ["(write-back not run)"];
  const lines = [
    ...wb.created.map((p) => `created: ${p}`),
    ...wb.updated.map((p) => `updated: ${p}`),
    ...wb.skipped.map((s) => `skipped: ${s}`),
  ];
  return lines.length > 0 ? lines : ["(no changes)"];
}
