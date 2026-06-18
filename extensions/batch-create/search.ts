/**
 * FTS5-based semantic search and [[wikilink]] appending for batch-created documents.
 *
 * Replaces the DuckDB BM25 implementation with FTS5 via db-sqlite.ts.
 * `findRelated` uses `searchDocs` which leverages FTS5's built-in BM25 ranking.
 * `appendLinks` is unchanged — it only reads and writes markdown files.
 */

import { readFile, writeFile } from "node:fs/promises";
import type { SqliteDb } from "../para-knowledge/db-sqlite.js";
import { searchDocs } from "../para-knowledge/db-sqlite.js";

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
export async function findRelated(
  db: SqliteDb,
  relPath: string,
  title: string,
  tags: string[],
  maxResults: number,
): Promise<string[]> {
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
    const rows = db.prepare(
      `SELECT d.path, d.rank FROM docs_fts d WHERE d.docs_fts MATCH ? ORDER BY d.rank LIMIT ?`,
    ).all<{ path: string; rank: number }>(ftsQuery, maxResults);

    return rows.map((r) => ({ path: r.path, score: r.rank }));
  } catch {
    // If the query fails (e.g., invalid FTS5 syntax), return empty
    return [];
  }
}

/**
 * Append [[wikilinks]] to a markdown file under a "## Relevant notes" section.
 */
export async function appendLinks(filePath: string, links: string[]): Promise<void> {
  if (links.length === 0) return;

  const content = await readFile(filePath, "utf-8");
  const body = content.replace(/^---\n[\s\S]*?\n---\n?/, "").trim();

  const newSlugs = links.map((p) => {
    const slug = p.replace(/\.md$/, "").split("/").pop() ?? "";
    return `[[${slug}]]`;
  });

  const hasSection = /^##\s+Relevant notes\s*$/m.test(body);

  let newBody: string;
  if (hasSection) {
    const lines = body.split("\n");
    const sectionIdx = lines.findIndex((l) => /^##\s+Relevant notes\s*$/.test(l));
    let insertIdx = sectionIdx + 1;
    while (insertIdx < lines.length && /^\s*[-*]\s/.test(lines[insertIdx])) insertIdx++;

    const existingLinks = new Set<string>();
    for (let i = sectionIdx + 1; i < lines.length; i++) {
      const m = lines[i].match(/\[\[([^\]]+)\]\]/);
      if (m) existingLinks.add(m[1]);
    }
    const toAdd = newSlugs.filter((s) => {
      const slugMatch = s.match(/\[\[([^\]]+)\]\]/);
      return slugMatch ? !existingLinks.has(slugMatch[1]) : true;
    });
    if (toAdd.length === 0) return;

    const indent =
      insertIdx > sectionIdx + 1 ? (lines[sectionIdx + 1].match(/^\s*/)?.[0] ?? "- ") : "- ";
    lines.splice(insertIdx, 0, ...toAdd.map((l) => `${indent}${l}`));
    newBody = lines.join("\n");
  } else {
    newBody = body + "\n\n## Relevant notes\n\n" + newSlugs.map((s) => `- ${s}`).join("\n");
  }

  const fmMatch = content.match(/^---\n[\s\S]*?\n---\n/);
  const frontmatter = fmMatch ? fmMatch[0] : "";
  await writeFile(filePath, frontmatter + newBody, "utf-8");
}
