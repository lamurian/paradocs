/**
 * FTS5-based semantic search and [[wikilink]] appending for batch-created documents.
 *
 * Replaces the DuckDB BM25 implementation with FTS5 via db-sqlite.ts.
 * `findRelated` uses `searchDocs` which leverages FTS5's built-in BM25 ranking.
 * `appendLinks` is unchanged — it only reads and writes markdown files.
 */

import { readFile, writeFile } from "node:fs/promises";

import type { SqliteDb } from "../para-knowledge/db-sqlite.js";

/**
 * Find related documents via FTS5 BM25 search.
 * Returns up to `maxResults` paths sorted by relevance, excluding the
 * source document itself.
 *
 * Uses OR between tag terms so that any document sharing at least one
 * content tag is considered related. FTS5 BM25 ranks matches higher
 * when multiple tags overlap. The title is included for additional
 * topically-relevant suggestions.
 */
export function findRelated(
  db: SqliteDb,
  relPath: string,
  title: string,
  tags: string[],
  maxResults: number,
): string[] {
  // Clean hyphens from tags (FTS5 tokenizes hyphenated words as separate terms)
  const cleanedTags = tags.map((t) => t.replace(/-/g, " "));
  // Build an OR query: any matching tag or title word is sufficient
  const queryParts: string[] = [...cleanedTags];
  if (title.trim()) queryParts.push(title.trim());

  const rawQuery = queryParts.join(" OR ").trim();
  if (!rawQuery) return [];

  // We bypass the AND-based buildFts5Query and construct the FTS5 query directly
  const terms = rawQuery
    .toLowerCase()
    .split(/\s+(?:OR\s+)?/)
    .flatMap((t) => t.split(/\s+/))
    .filter((t) => t.length > 1);
  if (terms.length === 0) return [];

  // Build an OR query: any matching term qualifies
  const ftsQuery = terms.map((t) => `"${t}"`).join(" OR ");

  const results = searchDocsFts(db, ftsQuery, maxResults + 1);

  return results
    .filter((r) => r.path !== relPath)
    .slice(0, maxResults)
    .map((r) => r.path);
}

/**
 * Direct FTS5 search with a raw query string (bypasses buildFts5Query's AND logic).
 * Used by findRelated for OR-based term matching.
 */
function searchDocsFts(
  db: SqliteDb,
  ftsQuery: string,
  maxResults: number,
): Array<{ path: string; score: number }> {
  try {
    const rows = db
      .prepare(
        `SELECT d.path, d.rank FROM docs_fts d WHERE d.docs_fts MATCH ? ORDER BY d.rank LIMIT ?`,
      )
      .all<{ path: string; rank: number }>(ftsQuery, maxResults);

    return rows.map((r) => ({ path: r.path, score: r.rank }));
  } catch {
    // If the query fails (e.g., invalid FTS5 syntax), return empty
    return [];
  }
}

/**
 * Append markdown links to a markdown file under a "## Relevant notes" section.
 *
 * Looks up each linked document's title from the SQLite `files` table by path.
 * Falls back to slug (filename without .md) if the path is not found or has no title.
 */
export async function appendLinks(filePath: string, links: string[], db: SqliteDb): Promise<void> {
  if (links.length === 0) return;

  const content = await readFile(filePath, "utf-8");
  const body = content.replace(/^---\n[\s\S]*?\n---\n?/, "").trim();

  // Look up titles from SQLite, fall back to slug
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

    // Extract existing markdown link paths for dedup
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
