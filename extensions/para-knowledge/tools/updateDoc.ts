/**
 * update_para_doc tool — updates an existing markdown file's body content,
 * renews its YAML frontmatter, and refreshes the SQLite index (including
 * FTS5 term index) inside a single transaction.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createDb, initDb, indexFile } from "../db-sqlite.js";
import type { DocIndex } from "../db-sqlite.js";
import { parseFrontmatter, formatFrontmatter } from "../frontmatter.js";

const DB_FILE = "notes.db";

/**
 * Register the update_para_doc tool.
 */
export function registerUpdateDocTool(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "update_para_doc",
    label: "Update PARA Doc",
    description:
      "Update an existing markdown file's body content and renew its YAML frontmatter " +
      "(date refreshed, author: pi / editor: lam preserved). Also syncs the SQLite index " +
      "including the FTS5 term index.",
    promptSnippet: "Update and renew frontmatter of an existing knowledge document",
    parameters: Type.Object({
      path: Type.String({ description: "Relative path, e.g. Projects/my-doc.md" }),
      content: Type.String({ description: "New body content (without frontmatter)" }),
      tags: Type.Optional(Type.Array(Type.String(), { description: "Replacement tags (omit to keep existing)" })),
      title: Type.Optional(Type.String({ description: "Replacement title (omit to keep existing)" })),
      description: Type.Optional(Type.String({ description: "Short summary ≤ 200 characters (omit to keep existing; empty string to clear)" })),
      source: Type.Optional(Type.String({ description: "Replacement source URL (omit to keep existing; empty string to clear)" })),
    }),

    async execute(_toolCallId, params, _signal, onUpdate, ctx) {
      const filePath = resolve(ctx.cwd, params.path);
      const existing = await readFile(filePath, "utf-8");
      const fm = parseFrontmatter(existing);
      const now = new Date().toISOString();

      const newTitle = params.title ?? fm.title ?? "";
      const newTags = params.tags ?? fm.tags ?? [];
      const newDescription =
        params.description !== undefined ? params.description || null : (fm.description ?? null);
      const newSource =
        params.source !== undefined ? params.source || null : (fm.source_url ?? null);

      // Write updated file to disk
      const frontmatterFields: Record<string, unknown> = {
        title: newTitle,
        author: "pi",
        editor: "lam",
        date: now,
        tags: newTags,
      };
      if (newDescription) frontmatterFields.description = newDescription;
      if (newSource) frontmatterFields.source = newSource;

      const newFm = formatFrontmatter(frontmatterFields);
      await writeFile(filePath, newFm + "\n" + params.content, "utf-8");

      // Update SQLite index
      onUpdate?.({
        content: [{ type: "text" as const, text: "🗄️ notes.db — updating index row…" }],
        details: {},
      });

      let indexOk = false;
      try {
        const db = createDb(resolve(ctx.cwd, DB_FILE));
        initDb(db);
        const doc: DocIndex = {
          path: params.path,
          title: newTitle,
          body: (newDescription ?? "") + "\n" + params.content,
          tags: newTags,
          author: "pi",
          editor: "lam",
          created: fm.date ?? fm.created ?? now,
          modified: now,
          file_mtime: now,
          source_url: newSource,
        };
        indexFile(db, doc);
        db.close();
        indexOk = true;
      } catch (e: unknown) {
        console.error("[para-knowledge] SQLite update failed:", e);
      }

      const indexNote = indexOk
        ? "🗄️ notes.db — updated"
        : "⚠️  File updated but index update skipped. Will be synced on next search.";
      const sourceNote = newSource ? `\nSource: ${newSource}` : "";

      return {
        content: [{
          type: "text" as const,
          text: `${indexNote}\nUpdated: ${filePath} (frontmatter renewed).${sourceNote}`,
        }],
        details: {
          path: filePath,
          title: newTitle,
          description: newDescription,
          source: newSource,
          indexOk,
        },
      };
    },
  });
}
