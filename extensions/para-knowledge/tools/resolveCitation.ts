/**
 * resolve_citation — tool wrapper around common/citation.ts.
 *
 * Thin adapter: parses params via typebox, delegates to the shared
 * resolveCitation function, and formats the result for tool output.
 *
 * @module extensions/para-knowledge/tools/resolveCitation
 */

import { Type } from "typebox";

import { resolveCitation } from "../../../common/citation.js";

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export function registerResolveCitationTool(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "resolve_citation",
    label: "Resolve Citation",
    description:
      "Parse a URL or DOI via citation.js, generate a unique BibTeX citekey, " +
      "deduplicate against the SQLite knowledge base, and append new entries to @ref.bib.",
    promptSnippet:
      "Resolve a citation source: parse via citation.js, check dedup, insert into " +
      "notes.db and append to ref.bib if new.",
    parameters: Type.Object({
      source: Type.String({ description: "DOI or URL to resolve." }),
      title: Type.Optional(
        Type.String({ description: "Title (needed when citation.js cannot parse the URL)." }),
      ),
      authors: Type.Optional(
        Type.Array(Type.String({ description: "Author names in 'Last, First' format." })),
      ),
      year: Type.Optional(Type.Number({ description: "Publication year for fallback." })),
      accessed: Type.Optional(
        Type.String({ description: "Access date in ISO 8601 format (defaults to today)." }),
      ),
    }),

    async execute(_toolCallId, params, _signal, onUpdate, ctx) {
      onUpdate?.({
        content: [{ type: "text" as const, text: `📖 Resolving citation: ${params.source}…` }],
        details: {},
      });

      const result = await resolveCitation(params, { cwd: ctx.cwd });

      if (result.error) {
        return {
          content: [{ type: "text" as const, text: `❌ ${result.error}` }],
          details: { citekey: null, bibtex: null, isNew: false, error: result.error },
        };
      }

      if (!result.isNew) {
        return {
          content: [
            {
              type: "text" as const,
              text: `✅ Citation already exists.\nCitekey: @${result.citekey}\n\n\`\`\`bibtex\n${result.bibtex}\n\`\`\``,
            },
          ],
          details: {
            citekey: result.citekey,
            bibtex: result.bibtex,
            isNew: false,
            doi: result.doi,
            source_url: result.source_url,
          },
        };
      }

      return {
        content: [
          {
            type: "text" as const,
            text: `✅ New citation created.\nCitekey: @${result.citekey}\nAppended to: ref.bib\n\n\`\`\`bibtex\n${result.bibtex}\n\`\`\``,
          },
        ],
        details: {
          citekey: result.citekey,
          bibtex: result.bibtex,
          isNew: true,
          doi: result.doi,
          source_url: result.source_url,
        },
      };
    },
  });
}
