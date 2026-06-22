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
import { createDocument } from "../../../common/createDocument.js";
import { getKnowledgeConfig } from "../../../common/env.js";

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

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
      "Atomic principle — one key idea per note, max 4 paragraphs (or 2 heading sections), ≤100 lines total. " +
      "Validates atomicity (single topic, ≤4 paragraphs, ≤2 headings) before creation. " +
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
      const validation = validateAtomicity(params.content, params.title);
      if (!validation.valid) {
        return {
          content: [
            {
              type: "text" as const,
              text: `❌ ${validation.message}`,
            },
          ],
          details: {
            error: "ATOMICITY_VIOLATION",
            rule: validation.rule,
            count: validation.count,
            limit: validation.limit,
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
