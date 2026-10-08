/**
 * Write-back assembly helpers: fill-body collection, unplanned-source
 * surfacing, and the draft-note fallback. Extracted from writeBackToKB so
 * the orchestration function stays within the complexity budget.
 *
 * @module extensions/research-engine/writeback-assembly
 */

import { writeDraftNote } from "./draft.js";

import type { ResearchResult, ResearchSource } from "./types.js";
import type { GroupedNote } from "./writeback-helpers.js";
import type { PlanEntry, WritebackCallResult } from "./writeback-plan.js";

/** One fill outcome: the planned entry plus its subagent call result. */
export interface FillOutcome {
  entry: PlanEntry;
  res: WritebackCallResult<string>;
}

/**
 * Assemble note bodies from fill outcomes; failed fills become skip lines.
 *
 * @param fills - Fill outcomes in plan order.
 * @returns Notes with bodies plus 'note skipped: <title> (<error>)' lines.
 */
export function assembleFills(fills: FillOutcome[]): {
  notes: GroupedNote[];
  skipped: string[];
} {
  const notes: GroupedNote[] = [];
  const skipped: string[] = [];
  for (const { entry, res } of fills) {
    const body = res.ok && typeof res.value === "string" ? res.value.trim() : "";
    if (body.length > 0) {
      notes.push({
        title: entry.title,
        content: body,
        tags: entry.tags,
        area: entry.area,
        source: entry.sources[0],
      });
    } else {
      const err = !res.ok ? (res.error ?? "fill failed") : "empty note body";
      skipped.push(`note skipped: ${entry.title} (${err})`);
    }
  }
  return { notes, skipped };
}

/**
 * Lines flagging sources the plan never referenced — never silent.
 *
 * @param sources - Collected research sources.
 * @param plan - Validated plan entries.
 * @param onProgress - Optional progress channel per unplanned source.
 * @returns 'source not planned: <url>' lines, in source order.
 */
export function unplannedSourceLines(
  sources: ResearchSource[],
  plan: PlanEntry[],
  onProgress?: (message: string) => void,
): string[] {
  const referenced = new Set(plan.flatMap((e) => e.sources));
  const lines: string[] = [];
  for (const s of sources) {
    if (referenced.has(s.url)) continue;
    const line = `source not planned: ${s.url}`;
    lines.push(line);
    onProgress?.(line);
  }
  return lines;
}

/**
 * Draft-note fallback lines: sources + citekeys + synthesis are preserved
 * when grouping fails, so no collected research is discarded silently.
 *
 * @param knowledgeDir - KNOWLEDGE_DIR resolved from env config.
 * @param result - Research result carrying jobId/sources/synthesis.
 * @param citekeys - Resolved URL -> citekey map.
 * @returns Skip lines: 'draft: <path>' or 'draft failed: <error>'.
 */
export function draftFallbackLines(
  knowledgeDir: string,
  result: ResearchResult & { jobId?: string; synthesis?: string },
  citekeys: Map<string, string>,
): string[] {
  try {
    const path = writeDraftNote(knowledgeDir, {
      jobId: result.jobId ?? "unknown-job",
      question: result.questions[0],
      sources: result.sources,
      citekeys,
      synthesis: result.synthesis,
    });
    return [`draft: ${path}`];
  } catch (e: unknown) {
    return [`draft failed: ${(e instanceof Error ? e.message : String(e)).slice(0, 200)}`];
  }
}
