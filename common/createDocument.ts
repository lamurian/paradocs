/**
 * Shared document creation module — PARA knowledge doc pipeline.
 *
 * Creates a markdown file with YAML frontmatter, indexes it in the
 * SQLite FTS5 knowledge base, and runs BM25 auto-linking.
 *
 * @module common/createDocument
 */

import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { autoLink } from "./autoLink.js";
import { configureEnv, getKnowledgeConfig } from "./env.js";
import { slugify } from "./slug.js";
import { formatFrontmatter } from "./yaml.js";
import { createDb, initDb, indexFile } from "../extensions/para-knowledge/db-sqlite.js";
import { rebuildDb } from "../extensions/para-knowledge/rebuild.js";

import type { DocIndex } from "../extensions/para-knowledge/db-sqlite.js";

// ── Helpers ─────────────────────────────────────────────────────────

function getAutoDesc(params: { description?: string; content: string }): string | null {
  return (
    params.description?.trim() || params.content.replace(/\n+/g, " ").slice(0, 150).trim() || null
  );
}

async function indexDocInDb(
  relPath: string,
  params: {
    title: string;
    content: string;
    tags: string[];
    source?: string | null;
  },
  autoDesc: string | null,
  now: string,
): Promise<boolean> {
  try {
    const { dir, db: dbName } = getKnowledgeConfig();
    const dbPath = resolve(dir, dbName);
    if (!existsSync(dbPath)) {
      await rebuildDb(dir);
    }
    const db = createDb(dbPath);
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
    console.error("[createDocument] SQLite insert failed:", e);
    return false;
  }
}

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
    console.error("[createDocument] Auto-link failed:", msg);
    return 0;
  }
}

// ── Main export ─────────────────────────────────────────────────────

/**
 * Create a new PARA knowledge document.
 *
 * Writes a markdown file with YAML frontmatter to the appropriate
 * PARA directory, indexes it in the SQLite FTS5 knowledge base, and
 * runs BM25 auto-linking against existing documents.
 *
 * @param params.title       - Document title (used for filename slug).
 * @param params.content     - Markdown body content.
 * @param params.tags        - Tags for frontmatter and search indexing.
 * @param params.area        - PARA area: "Areas", "Projects", or "Resources" (default).
 * @param params.description - Short summary for BM25 search (≤200 chars).
 * @param params.source      - Original source URL (optional).
 * @param options.cwd        - Working directory for env config resolution.
 * @returns Object with file path, title, auto-link count, and index status.
 */
export async function createDocument(
  params: {
    title: string;
    content: string;
    tags: string[];
    area?: string;
    description?: string;
    source?: string;
  },
  options: { cwd: string },
): Promise<{
  path: string;
  title: string;
  linkCount: number;
  indexOk: boolean;
}> {
  // Ensure .env is loaded
  configureEnv(options.cwd);

  const area = params.area ?? "Resources";
  const { dir: knowledgeDir } = getKnowledgeConfig(options.cwd);
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
  const indexOk = await indexDocInDb(relPath, params, autoDesc, now);

  // Auto-link
  let linkCount = 0;
  if (indexOk) {
    const { dir: kd, db: dbName } = getKnowledgeConfig(options.cwd);
    linkCount = await runAutoLink(relPath, params.title, params.tags, kd, dbName);
  }

  return { path: relPath, title: params.title, linkCount, indexOk };
}
