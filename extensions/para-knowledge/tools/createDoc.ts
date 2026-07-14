/**
 * create_para_doc tool — thin wrapper around common/createDocument.ts.
 *
 * Adapter: parses params via typebox, delegates to the shared
 * createDocument function, and formats the result for tool output.
 *
 * @module extensions/para-knowledge/tools/createDoc
 */

import { resolve } from "node:path";

import { Type } from "typebox";

import { validateAtomicity } from "../../../common/atomicity.js";
import { validateCitations } from "../../../common/citation-validation.js";
import { createDocument } from "../../../common/createDocument.js";
import { getKnowledgeConfig } from "../../../common/env.js";
import { ensureNotesDb } from "../../../common/notesDb.js";

import type { AtomicityResult } from "../../../common/atomicity.js";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/**
 * Build the error response for an atomicity violation.
 */
function buildAtomicityError(validation: AtomicityResult): {
  content: Array<{ type: "text"; text: string }>;
  details: Record<string, unknown>;
} {
  const splits = validation.suggestedSplits;
  if (splits && splits.length > 0) {
    const splitLines = splits
      .map((s, i) => `  ${i + 1}. **${s.title}** (${s.area}) — tags: ${s.tags.join(", ")}`)
      .join("\n");
    return {
      content: [
        {
          type: "text" as const,
          text:
            `❌ Atomicity violation. Found ${splits.length} distinct Q&A pairs in your content.\n` +
            `Use batch_create_para_docs with these ${splits.length} documents instead:\n\n${splitLines}`,
        },
      ],
      details: {
        error: "ATOMICITY_VIOLATION",
        suggestedSplits: splits,
      },
    };
  }
  return {
    content: [
      {
        type: "text" as const,
        text: `❌ ${validation.message}`,
      },
    ],
    details: {
      error: "ATOMICITY_VIOLATION",
    },
  };
}

/**
 * Register the create_para_doc tool.
 */
export function registerCreateDocTool(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "create_para_doc",
    label: "Create PARA Doc",
    description:
      "Create a new PARA knowledge document (markdown + YAML frontmatter) and index it in notes.db. " +
      "Conventions: PARA classification — Resources for reference/theory, Areas for responsibilities/skills, " +
      "Projects for deliverables/practical work. " +
      "Atomic principle — one key idea per note (one research question + one indicative answer). " +
      "Validates atomicity (single coherent topic — one research question and one indicative answer) and citation references before creation. " +
      "Filename auto-generated as kebab-case slug from title — keep titles concise. " +
      "Recommended body: ## Summary (2-4 paragraphs), ## Key Points, ## Sources. " +
      "Citations: Pandoc-style @citekey (narrative) or [@citekey] (parenthetical) from @ref.bib. " +
      "Run list_para_tags first and reuse existing tags. Provide short description ≤ 200 chars for BM25 search.",
    promptSnippet:
      "Create a new knowledge document in the PARA directory structure — validates atomicity, uses Pandoc citations",
    parameters: Type.Object({
      title: Type.String({ description: "Document title" }),
      content: Type.String({ description: "Markdown body content" }),
      tags: Type.Array(Type.String(), { description: "Tags for frontmatter" }),
      area: Type.Optional(
        Type.String({ description: 'PARA category: "Areas", "Projects", or "Resources"' }),
      ),
      description: Type.Optional(
        Type.String({ description: "Short summary ≤ 200 characters, enriches BM25 search" }),
      ),
      source: Type.Optional(Type.String({ description: "Original source URL (optional)" })),
    }),

    async execute(_toolCallId, params, _signal, onUpdate, ctx) {
      // Atomicity validation — runs before any IO or DB operations
      const validation = await validateAtomicity(params.content, params.title);
      if (!validation.valid) {
        return buildAtomicityError(validation);
      }

      // Citation validation — after atomicity, before any IO
      const db = await ensureNotesDb(ctx.cwd);
      const citationResult = validateCitations(params.content, db);
      if (!citationResult.valid) {
        return {
          content: [
            {
              type: "text" as const,
              text:
                `❌ Citation validation failed — ${citationResult.missing.length} unresolved citekey(s): ` +
                citationResult.missing.join(", ") +
                ". Call `resolve_citation` for each before retrying.",
            },
          ],
          details: {
            error: "CITATION_VIOLATION",
            missing: citationResult.missing,
          },
        };
      }

      onUpdate?.({
        content: [{ type: "text" as const, text: "🗄️ Creating document…" }],
        details: {},
      });

      const area = params.area ?? "Resources";
      const autoDesc =
        params.description?.trim() ||
        params.content.replace(/\n+/g, " ").slice(0, 150).trim() ||
        null;

      const result = await createDocument(
        {
          title: params.title,
          content: params.content,
          tags: params.tags,
          area,
          description: params.description,
          source: params.source,
        },
        { cwd: ctx.cwd },
      );

      // Resolve absolute path for backward compatibility
      const { dir: knowledgeDir } = getKnowledgeConfig(ctx.cwd);
      const absPath = resolve(knowledgeDir, result.path);

      const indexNote = result.indexOk
        ? "🗄️ notes.db — indexed"
        : "⚠️  File created but index update failed. It will be indexed on next search.";
      const linkNote =
        result.linkCount > 0
          ? `\n🔗 Auto-linked to ${result.linkCount} related note${result.linkCount === 1 ? "" : "s"}`
          : "";
      const descNote = autoDesc ? `\nDescription: ${autoDesc}` : "";
      const sourceNote = params.source ? `\nSource: ${params.source}` : "";

      return {
        content: [
          {
            type: "text" as const,
            text: `${indexNote}\nCreated: ${absPath}\nTitle: ${result.title}\nTags: ${params.tags.join(", ")}${descNote}${sourceNote}${linkNote}`,
          },
        ],
        details: {
          path: absPath,
          title: result.title,
          description: autoDesc,
          tags: params.tags,
          source: params.source ?? null,
          indexOk: result.indexOk,
          autoLinked: result.linkCount,
        },
      };
    },
  });
}
