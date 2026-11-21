/**
 * para-evidence — get_evidence tool.
 *
 * Reads an evidence pack written by gather_evidence from the cwd cache and
 * returns it as text. Source content is included only when explicitly
 * requested, keeping default output compact.
 *
 * @module extensions/para-evidence
 */

import { Type } from "typebox";

import { registerGatherEvidenceTool } from "./gather-tool.ts";
import { registerVerifySourceTool } from "./verify-tools.ts";
import { loadEvidencePack } from "../../common/evidence-cache.ts";

import type { EvidencePack, EvidenceSource } from "../../common/evidence-cache.ts";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/**
 * Format one source as an indented text block.
 *
 * @param source - Source to render.
 * @param index - One-based source position.
 * @param includeContent - Whether to append the fetched content.
 * @returns Text lines for the source.
 */
function formatSource(source: EvidenceSource, index: number, includeContent: boolean): string[] {
  const lines = [
    `${index}. ${source.title}`,
    `   url: ${source.url}`,
    `   canonical: ${source.canonicalUrl}`,
    `   trust: ${source.trust} | tier: ${source.tier === null ? "n/a" : source.tier}`,
    `   query: ${source.query}`,
    `   excerpt: ${source.excerpt}`,
  ];

  if (source.fetchError) lines.push(`   fetch error: ${source.fetchError}`);
  if (includeContent && source.content !== undefined) {
    lines.push("   content:", source.content);
  }

  return lines;
}

/**
 * Render a complete evidence pack as plain text.
 *
 * @param pack - Pack to render.
 * @param includeContent - Whether source content is included.
 * @returns Human-readable pack text.
 */
export function formatEvidencePack(pack: EvidencePack, includeContent: boolean): string {
  const lines = [
    `Evidence pack ${pack.id}`,
    `Question: ${pack.question}`,
    `Created: ${pack.createdAt}`,
    "",
    "Queries:",
  ];

  if (pack.queries.length === 0) lines.push("- (none)");
  for (const query of pack.queries) {
    lines.push(`- ${query.query}`);
    lines.push(`  kb covered: ${query.kbCovered ? "yes" : "no"}`);
    lines.push(`  since: ${query.since ?? "n/a"}`);
    if (query.kbHits.length === 0) {
      lines.push("  kb hits: (none)");
    } else {
      for (const hit of query.kbHits) {
        lines.push(`  kb hit: ${hit.path} — ${hit.title} (${hit.freshness})`);
      }
    }
  }

  lines.push("", `Sources (${pack.sources.length}):`);
  if (pack.sources.length === 0) lines.push("- (none)");
  pack.sources.forEach((source, index) => {
    lines.push(...formatSource(source, index + 1, includeContent));
  });

  return lines.join("\n");
}

/**
 * Register the get_evidence tool.
 *
 * @param pi - The pi extension API.
 */
export default function (pi: ExtensionAPI): void {
  registerGatherEvidenceTool(pi);
  registerVerifySourceTool(pi);

  pi.registerTool({
    name: "get_evidence",
    label: "Get Evidence Pack",
    description:
      "Read a previously gathered evidence pack by id. Source content is " +
      "included only when includeContent is true.",
    promptSnippet: "Read a stored evidence pack by id (content optional)",
    parameters: Type.Object({
      id: Type.String({ description: "Evidence pack id, e.g. ev-abc123-1a2b" }),
      includeContent: Type.Optional(
        Type.Boolean({
          description: "Include stored source content in the output (default false)",
        }),
      ),
    }),

    execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const pack = loadEvidencePack(ctx.cwd, params.id);

      if (!pack) {
        return Promise.resolve({
          isError: true,
          content: [
            {
              type: "text" as const,
              text: `Evidence pack "${params.id}" not found.`,
            },
          ],
          details: { id: params.id, found: false },
        });
      }

      const includeContent = params.includeContent === true;
      return Promise.resolve({
        content: [{ type: "text" as const, text: formatEvidencePack(pack, includeContent) }],
        details: { id: pack.id, found: true, includeContent },
      });
    },
  });
}
