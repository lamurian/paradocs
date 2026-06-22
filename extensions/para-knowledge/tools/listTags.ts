/**
 * list_para_tags tool — returns all unique tags from the SQLite-indexed
 * PARA documents (Areas/Projects/Resources). Useful for choosing existing
 * tags when creating a new document, rather than inventing new ones.
 *
 * Returns an array of tag strings. If the database doesn't exist yet,
 * returns an empty array (no tags indexed).
 */

import { Type } from "typebox";

import { configureEnv } from "../../../common/env.js";
import { ensureNotesDb } from "../../../common/notesDb.js";

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

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
      // Ensure .env is loaded (from ~/.pi/agent/.env and <cwd>/.pi/.env)
      configureEnv(ctx.cwd);

      onUpdate?.({
        content: [{ type: "text" as const, text: "🏷️ notes.db — querying unique tags…" }],
        details: {},
      });

      try {
        const db = await ensureNotesDb(ctx.cwd);
        const rows = db
          .prepare("SELECT DISTINCT tag FROM tags ORDER BY tag")
          .all<{ tag: string }>();

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
