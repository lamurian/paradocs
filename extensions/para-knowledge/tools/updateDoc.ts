/**
 * update_para_doc tool — updates an existing markdown file's body content,
 * renews its YAML frontmatter, and refreshes the SQLite index (including
 * FTS5 term index) inside a single transaction.
 */

import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { Type } from "typebox";

import { getKnowledgeConfig } from "../../../common/env.js";
import { createDb, initDb, indexFile } from "../db-sqlite.js";
import { parseFrontmatter, formatFrontmatter } from "../frontmatter.js";

import type { DocIndex } from "../db-sqlite.js";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

interface ResolvedFields {
  newTitle: string;
  newTags: string[];
  newDescription: string | null;
  newSource: string | null;
}

/**
 * Resolve incoming params against existing frontmatter.
 */
function resolveUpdateFields(
  params: {
    title?: string;
    tags?: string[];
    description?: string;
    source?: string;
  },
  fm: { title?: string; tags?: string[]; description?: string | null; source_url?: string | null },
): ResolvedFields {
  return {
    newTitle: params.title ?? fm.title ?? "",
    newTags: params.tags ?? fm.tags ?? [],
    newDescription:
      params.description !== undefined ? params.description || null : (fm.description ?? null),
    newSource: params.source !== undefined ? params.source || null : (fm.source_url ?? null),
  };
}

/**
 * Build frontmatter fields for an updated document.
 */
function buildUpdateFrontmatter(
  title: string,
  tags: string[],
  description: string | null,
  source: string | null,
  now: string,
): string {
  const frontmatterFields: Record<string, unknown> = {
    title,
    author: "pi",
    editor: "lam",
    date: now,
    tags,
  };
  if (description) frontmatterFields.description = description;
  if (source) frontmatterFields.source = source;
  return formatFrontmatter(frontmatterFields);
}

/**
 * Update the SQLite index row for a document.
 */
function updateDocIndex(
  path: string,
  title: string,
  tags: string[],
  description: string | null,
  source: string | null,
  created: string,
  now: string,
  content: string,
): boolean {
  try {
    const { dir, db: dbName } = getKnowledgeConfig();
    const db = createDb(resolve(dir, dbName));
    initDb(db);
    const doc: DocIndex = {
      path,
      title,
      body: (description ?? "") + "\n" + content,
      tags,
      author: "pi",
      editor: "lam",
      created,
      modified: now,
      file_mtime: now,
      source_url: source,
    };
    indexFile(db, doc);
    db.close();
    return true;
  } catch (e: unknown) {
    console.error("[para-knowledge] SQLite update failed:", e);
    return false;
  }
}

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
      tags: Type.Optional(
        Type.Array(Type.String(), { description: "Replacement tags (omit to keep existing)" }),
      ),
      title: Type.Optional(
        Type.String({ description: "Replacement title (omit to keep existing)" }),
      ),
      description: Type.Optional(
        Type.String({
          description:
            "Short summary ≤ 200 characters (omit to keep existing; empty string to clear)",
        }),
      ),
      source: Type.Optional(
        Type.String({
          description: "Replacement source URL (omit to keep existing; empty string to clear)",
        }),
      ),
    }),

    async execute(_toolCallId, params, _signal, onUpdate, ctx) {
      const filePath = resolve(ctx.cwd, params.path);
      const existing = await readFile(filePath, "utf-8");
      const fm = parseFrontmatter(existing);
      const now = new Date().toISOString();

      const { newTitle, newTags, newDescription, newSource } = resolveUpdateFields(params, fm);

      // Write updated file to disk
      const newFm = buildUpdateFrontmatter(newTitle, newTags, newDescription, newSource, now);
      await writeFile(filePath, newFm + "\n" + params.content, "utf-8");

      // Update SQLite index
      onUpdate?.({
        content: [{ type: "text" as const, text: "🗄️ notes.db — updating index row…" }],
        details: {},
      });

      const created = fm.date ?? fm.created ?? now;
      const indexOk = updateDocIndex(
        params.path,
        newTitle,
        newTags,
        newDescription,
        newSource,
        created,
        now,
        params.content,
      );

      const indexNote = indexOk
        ? "🗄️ notes.db — updated"
        : "⚠️  File updated but index update skipped. Will be synced on next search.";
      const sourceNote = newSource ? `\nSource: ${newSource}` : "";

      return {
        content: [
          {
            type: "text" as const,
            text: `${indexNote}\nUpdated: ${filePath} (frontmatter renewed).${sourceNote}`,
          },
        ],
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
