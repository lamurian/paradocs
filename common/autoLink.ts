/**
 * Auto-link module — BM25-based semantic linking for PARA documents.
 *
 * After creating a document, this module finds semantically related
 * documents via FTS5 BM25 search and appends markdown links under a
 * "## Relevant notes" section.
 *
 * Uses BM25-only matching (no LLM evaluation) as per ADR-008 — the
 * FTS5 BM25 ranking naturally prioritises documents that share more
 * terms, providing effective semantic linking without model latency.
 */

import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import type { SqliteDb } from "../extensions/para-knowledge/sqlite-types.js";

// ── Constants ──────────────────────────────────────────────────────

/** Maximum number of related documents to link. */
const MAX_LINKS = 5;

// ── Public API ─────────────────────────────────────────────────────

/**
 * Find related documents via FTS5 BM25 search.
 *
 * Builds an OR query from the document's tags and title, then ranks
 * results by BM25 relevance. Excludes the source document itself.
 *
 * @param db - Open SQLite database handle.
 * @param relPath - Relative path of the source document (e.g. "Resources/foo.md").
 * @param title - Document title for term expansion.
 * @param tags - Document tags for term expansion.
 * @param maxResults - Maximum number of results to return (default 5).
 * @returns Array of relative paths sorted by relevance.
 */
export function findRelated(
  db: SqliteDb,
  relPath: string,
  title: string,
  tags: string[],
  maxResults: number = MAX_LINKS,
): string[] {
  const cleanedTags = tags.map((t) => t.replace(/-/g, " "));
  const queryParts: string[] = [...cleanedTags];
  if (title.trim()) queryParts.push(title.trim());

  const rawQuery = queryParts.join(" OR ").trim();
  if (!rawQuery) return [];

  const terms = rawQuery
    .toLowerCase()
    .split(/\s+(?:OR\s+)?/)
    .flatMap((t) => t.split(/\s+/))
    .filter((t) => t.length > 1);
  if (terms.length === 0) return [];

  const ftsQuery = terms.map((t) => `"${t}"`).join(" OR ");

  try {
    const rows = db
      .prepare(
        `SELECT d.path, d.rank FROM docs_fts d WHERE d.docs_fts MATCH ? ORDER BY d.rank LIMIT ?`,
      )
      .all<{ path: string; rank: number }>(ftsQuery, maxResults + 1);

    return rows
      .filter((r) => r.path !== relPath)
      .slice(0, maxResults)
      .map((r) => r.path);
  } catch {
    return [];
  }
}

/**
 * Append markdown links to a file under a "## Relevant notes" section.
 *
 * Reads the file, extracts the body (after frontmatter), and appends
 * links if they are not already present. Looks up each linked document's
 * title from the SQLite `files` table for human-readable link text.
 *
 * @param filePath - Absolute path to the markdown file to modify.
 * @param links - Array of relative document paths to link.
 * @param db - Open SQLite database handle (for title lookups).
 */
export async function appendLinks(filePath: string, links: string[], db: SqliteDb): Promise<void> {
  if (links.length === 0) return;

  const content = await readFile(filePath, "utf-8");
  const body = content.replace(/^---\n[\s\S]*?\n---\n?/, "").trim();

  // Look up titles from SQLite; fall back to slug (filename without extension)
  const newLinks = links.map((p) => {
    const row = db.get<{ title: string }>("SELECT title FROM files WHERE path = ?", p);
    const title = row?.title?.trim() || (p.replace(/\.md$/, "").split("/").pop() ?? "");
    return `[${title}](${p})`;
  });

  const hasSection = /^##\s+Relevant notes\s*$/m.test(body);

  let newBody: string;
  if (hasSection) {
    const lines = body.split("\n");
    const sectionIdx = lines.findIndex((l) => /^##\s+Relevant notes\s*$/.test(l));
    let insertIdx = sectionIdx + 1;
    while (insertIdx < lines.length && /^\s*[-*]\s/.test(lines[insertIdx])) insertIdx++;

    // Collect existing link paths for deduplication
    const existingLinks = new Set<string>();
    for (let i = sectionIdx + 1; i < lines.length; i++) {
      const m = lines[i].match(/\[([^\]]+)\]\(([^)]+)\)/);
      if (m) existingLinks.add(m[2]);
    }
    const toAdd = newLinks.filter((l) => {
      const pathMatch = l.match(/\[([^\]]+)\]\(([^)]+)\)/);
      return pathMatch ? !existingLinks.has(pathMatch[2]) : true;
    });
    if (toAdd.length === 0) return;

    const indent =
      insertIdx > sectionIdx + 1 ? (lines[sectionIdx + 1].match(/^\s*/)?.[0] ?? "- ") : "- ";
    lines.splice(insertIdx, 0, ...toAdd.map((l) => `${indent}${l}`));
    newBody = lines.join("\n");
  } else {
    newBody = body + "\n\n## Relevant notes\n\n" + newLinks.map((l) => `- ${l}`).join("\n");
  }

  const fmMatch = content.match(/^---\n[\s\S]*?\n---\n/);
  const frontmatter = fmMatch ? fmMatch[0] : "";
  await writeFile(filePath, frontmatter + newBody, "utf-8");
}

/**
 * Run auto-linking for a newly created document.
 *
 * Finds top related documents via BM25 and appends markdown links
 * under a "## Relevant notes" section. The operation is idempotent —
 * it will not duplicate existing links.
 *
 * @param relPath - Relative path of the new document (e.g. "Resources/foo.md").
 * @param title - Document title.
 * @param tags - Document tags.
 * @param knowledgeDir - Absolute path to the knowledge base root directory.
 * @param db - Open SQLite database handle.
 * @returns Number of links appended (0 if none found or error).
 */
export async function autoLink(
  relPath: string,
  title: string,
  tags: string[],
  knowledgeDir: string,
  db: SqliteDb,
): Promise<number> {
  const related = findRelated(db, relPath, title, tags, MAX_LINKS);
  if (related.length === 0) return 0;

  const filePath = resolve(knowledgeDir, relPath);
  await appendLinks(filePath, related, db);
  return related.length;
}
