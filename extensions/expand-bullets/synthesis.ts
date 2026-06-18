/**
 * Synthesizes expanded text from web search results for a single bullet point.
 */

import type { WebResult } from "./search.js";
import type { BulletInfo } from "./parser.js";

export interface Expansion {
  original: string;
  context: string;
  expanded: string;
  sources: WebResult[];
}

/**
 * Generate a coherent, paragraph-form expansion of a single bullet point
 * by combining web search results into a synthesised explanation.
 */
export function synthesizeExpansion(bullet: BulletInfo, results: WebResult[]): string {
  const term = bullet.text;
  const ctx = bullet.context;

  let expansion = `**${term}** — `;

  if (results.length > 0 && results[0].snippet) {
    const core = results[0].snippet.replace(/\s+/g, " ").trim();
    expansion += core;
  } else {
    expansion += `This concept relates to ${ctx || "the broader topic"} and represents a key element that deserves deeper exploration.`;
  }

  if (results.length > 1) {
    const extras = results
      .slice(1, 3)
      .map((r) => r.snippet?.replace(/\s+/g, " ").trim())
      .filter(Boolean);
    if (extras.length > 0) expansion += ` ${extras.join(" ")}`;
  }

  return expansion;
}
