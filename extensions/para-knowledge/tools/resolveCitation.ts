/**
 * resolve_citation — preview-only tool wrapper around common/citation.ts.
 *
 * Thin adapter: parses params via typebox, delegates to the shared
 * previewCitation function, and formats the preview for tool output.
 * Nothing is written here; ingest commits citations passed to
 * stage_para_docs.
 *
 * @module extensions/para-knowledge/tools/resolveCitation
 */

import { Type } from "typebox";

import { previewCitation } from "../../../common/citation.ts";

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export function registerResolveCitationTool(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "resolve_citation",
    label: "Resolve Citation",
    description:
      "Preview a URL or DOI citation: parse via citation.js, generate a unique BibTeX " +
      "citekey, deduplicate against the knowledge base, and return date/urldate fields. " +
      "This tool never writes ref.bib or notes.db; pass the preview to stage_para_docs " +
      "and ingest commits citations.",
    promptSnippet:
      "Preview a citation source: parse via citation.js, check dedup, return a BibTeX " +
      "preview. Never writes ref.bib or notes.db; ingest commits citations passed to " +
      "stage_para_docs.",
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
        content: [{ type: "text" as const, text: `Resolving citation: ${params.source}…` }],
        details: {},
      });

      const result = await previewCitation(params, { cwd: ctx.cwd });

      if (result.error) {
        return {
          content: [{ type: "text" as const, text: `Error: ${result.error}` }],
          details: {
            citekey: null,
            bibtex: null,
            isNew: false,
            doi: null,
            source_url: null,
            published: null,
            error: result.error,
          },
        };
      }

      if (!result.isNew) {
        return {
          content: [
            {
              type: "text" as const,
              text:
                `Citation already exists.\nCitekey: @${result.citekey}\n\n` +
                `\`\`\`bibtex\n${result.bibtex}\n\`\`\``,
            },
          ],
          details: {
            citekey: result.citekey,
            bibtex: result.bibtex,
            isNew: false,
            doi: result.doi,
            source_url: result.source_url,
            published: result.published,
          },
        };
      }

      return {
        content: [
          {
            type: "text" as const,
            text:
              `New citation preview.\nCitekey: @${result.citekey}\n\n` +
              `\`\`\`bibtex\n${result.bibtex}\n\`\`\``,
          },
        ],
        details: {
          citekey: result.citekey,
          bibtex: result.bibtex,
          isNew: true,
          doi: result.doi,
          source_url: result.source_url,
          published: result.published,
        },
      };
    },
  });
}
