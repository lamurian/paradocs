/**
 * create_para_doc tool — creates a new markdown file with YAML frontmatter
 * and inserts it into the SQLite index (including FTS5 full-text search).
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createDb, initDb, indexFile } from "../db-sqlite.js";
import type { DocIndex } from "../db-sqlite.js";
import { formatFrontmatter } from "../frontmatter.js";
import { slugify } from "../files.js";

const DB_FILE = "notes.db";

/**
 * Register the create_para_doc tool.
 */
export function registerCreateDocTool(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "create_para_doc",
    label: "Create PARA Doc",
    description:
      "Create a new markdown file with YAML frontmatter in Areas, Projects, or Resources. " +
      "Also inserts the document and its FTS5 index into the SQLite database automatically.",
    promptSnippet: "Create a new knowledge document in the PARA directory structure",
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
      source: Type.Optional(
        Type.String({ description: "Original source URL (optional)" }),
      ),
    }),

    async execute(_toolCallId, params, _signal, onUpdate, ctx) {
      const area = params.area ?? "Resources";
      const dirPath = resolve(ctx.cwd, area);
      const slug = slugify(params.title);
      const filePath = resolve(dirPath, `${slug}.md`);
      const relPath = `${area}/${slug}.md`;
      const now = new Date().toISOString();

      // Auto-generate description from content if not provided
      const autoDesc = params.description?.trim() ||
        params.content.replace(/\n+/g, " ").slice(0, 150).trim() || null;

      // Build and write the markdown file
      const frontmatterFields: Record<string, unknown> = {
        title: params.title,
        author: "pi",
        editor: "lam",
        date: now,
        tags: params.tags,
      };
      if (autoDesc) frontmatterFields.description = autoDesc;
      if (params.source?.trim()) frontmatterFields.source = params.source.trim();

      const fm = formatFrontmatter(frontmatterFields);
      await mkdir(dirPath, { recursive: true });
      await writeFile(filePath, fm + "\n" + params.content, "utf-8");

      // Index in SQLite
      onUpdate?.({
        content: [{ type: "text" as const, text: "🗄️ notes.db — inserting into index…" }],
        details: {},
      });

      let indexOk = false;
      try {
        const db = createDb(resolve(ctx.cwd, DB_FILE));
        initDb(db);
        const doc: DocIndex = {
          path: relPath,
          title: params.title,
          body: (autoDesc ?? "") + "\n" + params.content,
          tags: params.tags,
          author: "pi",
          editor: "lam",
          created: now,
          modified: now,
          file_mtime: now,
          source_url: params.source || null,
        };
        indexFile(db, doc);
        db.close();
        indexOk = true;
      } catch (e: unknown) {
        console.error("[para-knowledge] SQLite insert failed:", e);
      }

      const indexNote = indexOk
        ? "🗄️ notes.db — indexed"
        : "⚠️  File created but index update failed. It will be indexed on next search.";
      const descNote = autoDesc ? `\nDescription: ${autoDesc}` : "";
      const sourceNote = params.source ? `\nSource: ${params.source}` : "";

      return {
        content: [{
          type: "text" as const,
          text: `${indexNote}\nCreated: ${filePath}\nTitle: ${params.title}\nTags: ${params.tags.join(", ")}${descNote}${sourceNote}`,
        }],
        details: {
          path: filePath,
          title: params.title,
          description: autoDesc,
          tags: params.tags,
          source: params.source ?? null,
          indexOk,
        },
      };
    },
  });
}
