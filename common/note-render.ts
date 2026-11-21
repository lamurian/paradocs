/**
 * Deterministic block-by-block markdown rendering for PARA notes.
 *
 * Notes are rendered from structured blocks so the same input always yields
 * the same markdown and a predictable content-line count.
 */

import { extractCitekeys } from "./citekeys.ts";
import { wrapText } from "./text-wrap.ts";
import { formatFrontmatter } from "./yaml.ts";

/** Structured note content supplied by the caller. */
export interface NoteBlocks {
  title: string;
  description: string;
  tags: string[];
  area: "Resources" | "Areas" | "Projects";
  summary: string[];
  keyPoints: string[];
  reviewed?: string;
  reviewInterval?: number;
}

/** Rendering options: wrap width and the clock used for frontmatter date. */
export interface RenderOptions {
  wrapWidth: number;
  now: Date;
}

/** Rendered note plus its line accounting and cited keys. */
export interface RenderedNote {
  markdown: string;
  contentLines: number;
  citekeys: string[];
}

/** Collect unique citekeys from summary entries and key points in order. */
function collectCitekeys(blocks: NoteBlocks): string[] {
  const seen = new Set<string>();
  const keys: string[] = [];

  for (const text of [...blocks.summary, ...blocks.keyPoints]) {
    for (const key of extractCitekeys(text)) {
      if (seen.has(key)) continue;
      seen.add(key);
      keys.push(key);
    }
  }

  return keys;
}

/** Render summary entries as wrapped paragraphs and grouped table rows. */
function renderSummary(summary: string[], width: number): { body: string; lines: number } {
  const blocks: string[] = [];
  const tableRows: string[] = [];
  let paragraphLines = 0;
  let tableLineCount = 0;

  const flushTable = (): void => {
    if (tableRows.length === 0) return;
    blocks.push(tableRows.join("\n"));
    tableRows.length = 0;
  };

  for (const entry of summary) {
    if (entry.startsWith("|")) {
      tableRows.push(entry);
      tableLineCount += Math.ceil(entry.length / width);
      continue;
    }

    flushTable();
    const lines = wrapText(entry, width);
    paragraphLines += lines.length;
    blocks.push(lines.join("\n"));
  }

  flushTable();

  return {
    body: blocks.join("\n\n"),
    lines: paragraphLines + tableLineCount,
  };
}

/** Render key points as a markdown list with two-space continuation lines. */
function renderKeyPoints(keyPoints: string[], width: number): { body: string; lines: number } {
  const lines: string[] = [];

  for (const point of keyPoints) {
    lines.push(...wrapText(point, width, { firstPrefix: "- ", restPrefix: "  " }));
  }

  return { body: lines.join("\n"), lines: lines.length };
}

/**
 * Render a note from structured blocks.
 *
 * Layout order: expanded frontmatter, Summary, Key Points, then Sources when
 * the note cites keys. Content lines cover wrapped summary paragraphs, key
 * point lines and table rows charged as ceil(length / width).
 *
 * @param blocks - Structured note content.
 * @param opts - Wrap width and the date used for frontmatter.
 * @returns Markdown, its content-line count and unique citekeys.
 */
export function renderNote(blocks: NoteBlocks, opts: RenderOptions): RenderedNote {
  const { wrapWidth, now } = opts;

  const fields: Record<string, unknown> = {
    title: blocks.title,
    description: blocks.description,
    author: "pi",
    editor: "lam",
    date: now.toISOString(),
    tags: blocks.tags,
  };
  if (blocks.reviewed !== undefined) fields.reviewed = blocks.reviewed;
  if (blocks.reviewInterval !== undefined) fields.review_interval = blocks.reviewInterval;

  const summary = renderSummary(blocks.summary, wrapWidth);
  const keyPoints = renderKeyPoints(blocks.keyPoints, wrapWidth);
  const citekeys = collectCitekeys(blocks);

  const sections: string[] = [formatFrontmatter(fields).trimEnd()];

  sections.push(`## Summary\n\n${summary.body}`);
  sections.push(`## Key Points\n\n${keyPoints.body}`);

  if (citekeys.length > 0) {
    const sources = citekeys.map((key) => `- @${key}`).join("\n");
    sections.push(`## Sources\n\n${sources}`);
  }

  const markdown = `${sections.join("\n\n").replace(/\n+$/, "")}\n`;

  return {
    markdown,
    contentLines: summary.lines + keyPoints.lines,
    citekeys,
  };
}
