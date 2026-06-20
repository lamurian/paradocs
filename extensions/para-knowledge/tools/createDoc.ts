/**
 * create_para_doc tool — creates a new markdown file with YAML frontmatter
 * and inserts it into the SQLite index (including FTS5 full-text search).
 */

import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { Type } from "typebox";

import { autoLink } from "../../../common/autoLink.js";
import { getKnowledgeConfig } from "../../../common/env.js";
import { createDb, initDb, indexFile } from "../db-sqlite.js";
import { slugify } from "../files.js";
import { formatFrontmatter } from "../frontmatter.js";

import type { DocIndex } from "../db-sqlite.js";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/**
 * Index a newly created document in the SQLite database.
 */
function indexDocInDb(
  relPath: string,
  params: {
    title: string;
    content: string;
    tags: string[];
    source?: string | null;
  },
  autoDesc: string | null,
  now: string,
): boolean {
  try {
    const { dir, db: dbName } = getKnowledgeConfig();
    const db = createDb(resolve(dir, dbName));
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
    return true;
  } catch (e: unknown) {
    console.error("[para-knowledge] SQLite insert failed:", e);
    return false;
  }
}

/** Auto-generate a description from content when none is provided. */
function getAutoDesc(params: { description?: string; content: string }): string | null {
  return (
    params.description?.trim() || params.content.replace(/\n+/g, " ").slice(0, 150).trim() || null
  );
}

/** Build the user-facing response text from creation results. */
function buildCreatedResponse(
  indexOk: boolean,
  autoDesc: string | null,
  source: string | undefined,
  filePath: string,
  title: string,
  tags: string[],
  linkCount: number,
): string {
  const indexNote = indexOk
    ? "🗄️ notes.db — indexed"
    : "⚠️  File created but index update failed. It will be indexed on next search.";
  const descNote = autoDesc ? `\nDescription: ${autoDesc}` : "";
  const sourceNote = source ? `\nSource: ${source}` : "";
  const linkNote =
    linkCount > 0
      ? `\n🔗 Auto-linked to ${linkCount} related note${linkCount === 1 ? "" : "s"}`
      : "";
  return `${indexNote}\nCreated: ${filePath}\nTitle: ${title}\nTags: ${tags.join(", ")}${descNote}${sourceNote}${linkNote}`;
}

/**
 * Run auto-linking for a newly created document.
 * Opens a fresh DB connection, calls autoLink, and handles all errors
 * gracefully — returns 0 when no links found or on any failure.
 */
async function runAutoLink(
  relPath: string,
  title: string,
  tags: string[],
  knowledgeDir: string,
  dbName: string,
): Promise<number> {
  try {
    const linkDb = createDb(resolve(knowledgeDir, dbName));
    initDb(linkDb);
    try {
      return await autoLink(relPath, title, tags, knowledgeDir, linkDb);
    } finally {
      linkDb.close();
    }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[para-knowledge] Auto-link failed:", msg);
    return 0;
  }
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
      "Atomic principle — one key idea per note, max 4 paragraphs (or 2 heading sections), ≤100 lines total. " +
      "Filename auto-generated as kebab-case slug from title — keep titles concise. " +
      "Recommended body: ## Summary (2-4 paragraphs), ## Key Points, ## Sources. " +
      "Citations: Pandoc-style @citekey (narrative) or [@citekey] (parenthetical) from @ref.bib. " +
      "Run list_para_tags first and reuse existing tags. Provide short description ≤ 200 chars for BM25 search.",
    promptSnippet:
      "Create a new knowledge document in the PARA directory structure — uses atomic principle, Pandoc citations",
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
      const area = params.area ?? "Resources";
      const { dir: knowledgeDir } = getKnowledgeConfig(ctx.cwd);
      const dirPath = resolve(knowledgeDir, area);
      const slug = slugify(params.title);
      const filePath = resolve(dirPath, `${slug}.md`);
      const relPath = `${area}/${slug}.md`;
      const now = new Date().toISOString();

      const autoDesc = getAutoDesc(params);

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

      const indexOk = indexDocInDb(relPath, params, autoDesc, now);

      // Auto-link: find related docs via BM25 and append relevant links
      let linkCount = 0;
      if (indexOk) {
        if (onUpdate) {
          onUpdate({
            content: [{ type: "text" as const, text: "🔗 Running auto-link…" }],
            details: {},
          });
        }
        const { dir: knowledgeDir, db: dbName } = getKnowledgeConfig(ctx.cwd);
        linkCount = await runAutoLink(relPath, params.title, params.tags, knowledgeDir, dbName);
      }

      const responseText = buildCreatedResponse(
        indexOk,
        autoDesc,
        params.source,
        filePath,
        params.title,
        params.tags,
        linkCount,
      );

      return {
        content: [{ type: "text" as const, text: responseText }],
        details: {
          path: filePath,
          title: params.title,
          description: autoDesc,
          tags: params.tags,
          source: params.source ?? null,
          indexOk,
          autoLinked: linkCount,
        },
      };
    },
  });
}
