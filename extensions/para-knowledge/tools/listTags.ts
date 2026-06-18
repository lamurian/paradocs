/**
 * list_para_tags tool — returns all unique tags from the SQLite-indexed
 * PARA documents (Areas/Projects/Resources). Useful for choosing existing
 * tags when creating a new document, rather than inventing new ones.
 *
 * Returns an array of tag strings. If the database doesn't exist yet,
 * returns an empty array (no tags indexed).
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { createDb, initDb } from "../db-sqlite.js";

const DB_FILE = "notes.db";

/**
 * Register the list_para_tags tool.
 */
export function registerListTagsTool(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "list_para_tags",
    label: "List PARA Tags",
    description:
      "Return all unique tags from the SQLite-indexed PARA documents " +
      "(Areas/Projects/Resources). Use this before create_para_doc to " +
      "choose existing tags and avoid tag proliferation.",
    promptSnippet: "List all existing unique tags in the PARA knowledge base",
    parameters: Type.Object({}),

    async execute(_toolCallId, _params, _signal, onUpdate, ctx) {
      onUpdate?.({
        content: [{ type: "text" as const, text: "🏷️ notes.db — querying unique tags…" }],
        details: {},
      });

      const dbPath = resolve(ctx.cwd, DB_FILE);
      if (!existsSync(dbPath)) {
        return {
          content: [
            {
              type: "text" as const,
              text: "📭 No documents indexed yet. Create a document first to populate the knowledge base.",
            },
          ],
          details: { tags: [], count: 0 },
        };
      }

      try {
        const db = createDb(dbPath);
        initDb(db);
        const rows = db.prepare("SELECT DISTINCT tag FROM tags ORDER BY tag")
          .all<{ tag: string }>();
        db.close();

        const tags = rows.map((r) => r.tag);

        if (tags.length === 0) {
          return {
            content: [
              {
                type: "text" as const,
                text: "🏷️ No tags found in the knowledge base yet. Create a document first to populate tags.",
              },
            ],
            details: { tags: [], count: 0 },
          };
        }

        return {
          content: [
            {
              type: "text" as const,
              text: `🏷️ Found ${tags.length} unique tag(s):\n\n${tags.map((t: string) => `- \`${t}\``).join("\n")}`,
            },
          ],
          details: { tags, count: tags.length },
        };
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error("[list_para_tags] SQLite error:", msg);
        return {
          content: [
            {
              type: "text" as const,
              text: "⚠️ Database error while querying tags.",
            },
          ],
          details: { tags: [], count: 0, error: msg },
        };
      }
    },
  });
}
