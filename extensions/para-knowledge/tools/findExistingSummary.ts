/**
 * find_existing_summary tool — checks whether a URL already has a summary
 * in the SQLite knowledge base, by exact `source_url` match and by content
 * similarity using FTS5 BM25 + word-trigram Jaccard similarity.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { createDb, initDb, searchDocs, type SqliteDb } from "../db-sqlite.js";
import { textSimilarity } from "../similarity.js";
import { readFile } from "node:fs/promises";

const DB_FILE = "notes.db";
const SIMILARITY_THRESHOLD = 0.9;

interface MatchResult {
  found: true;
  matchType: "exact_url" | "content_similarity";
  path: string;
  title: string;
  similarity: number;
}

async function findExactUrlMatch(
  db: SqliteDb,
  url: string,
): Promise<{ path: string; title: string } | null> {
  const row = db.prepare(
    "SELECT path, title FROM files WHERE source_url = ?",
  ).get<{ path: string; title: string }>(url);
  return row ?? null;
}

async function findSimilarByContent(
  db: SqliteDb,
  content: string,
  cwd: string,
): Promise<MatchResult | { found: false; matchType: "none" }> {
  if (content.trim().length < 50) return { found: false, matchType: "none" };

  // Use FTS5 to find top candidates
  const candidates = searchDocs(db, content.slice(0, 200), {}, 10);
  if (candidates.length === 0) return { found: false, matchType: "none" };

  let bestSim = 0;
  let bestPath = "";
  let bestTitle = "";

  for (const c of candidates) {
    // Read the full document body from disk
    let docBody = "";
    try {
      const fullPath = resolve(cwd, c.path);
      docBody = (await readFile(fullPath, "utf-8"))
        .replace(/^---\n[\s\S]*?\n---\n?/, "")
        .trim();
    } catch {
      continue;
    }
    if (docBody.length < 50) continue;

    const sim = textSimilarity(content, docBody);
    if (sim > bestSim) {
      bestSim = sim;
      bestPath = c.path;
      bestTitle = c.title;
    }
  }

  if (bestSim > SIMILARITY_THRESHOLD) {
    return { found: true, matchType: "content_similarity", path: bestPath, title: bestTitle, similarity: bestSim };
  }
  return { found: false, matchType: "none" };
}

export function registerFindExistingSummaryTool(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "find_existing_summary",
    label: "Find Existing Summary",
    description: "Check whether a URL already has a summary saved in the SQLite knowledge base.",
    promptSnippet: "Check if a URL already has a saved summary before re-summarising",
    parameters: Type.Object({
      url: Type.String({ description: "The URL to check for existing summaries" }),
      content: Type.Optional(
        Type.String({ description: "Optional extracted text content for content-based similarity matching." }),
      ),
    }),

    async execute(_toolCallId, params, _signal, onUpdate, ctx) {
      const { url, content } = params;
      const dbPath = resolve(ctx.cwd, DB_FILE);

      if (!existsSync(dbPath)) {
        return {
          content: [{ type: "text" as const, text: "📭 No knowledge base found yet." }],
          details: { found: false, notFoundReason: "no-db" },
        };
      }

      onUpdate?.({
        content: [{ type: "text" as const, text: `🔍 Checking for existing summary of ${url}...` }],
        details: {},
      });

      try {
        const db = createDb(dbPath);
        initDb(db);
        try {
          // Check exact URL match first
          const exact = await findExactUrlMatch(db, url);
          if (exact) {
            return {
              content: [{
                type: "text" as const,
                text: `✅ Found existing summary — Exact source_url match\n\n**Title:** ${exact.title}\n**Path:** ${exact.path}\n**URL:** ${url}\n\nNo need to re-summarise.`,
              }],
              details: { found: true, matchType: "exact_url", path: exact.path, title: exact.title, similarity: 1.0 },
            };
          }

          // Check content similarity if content is provided
          const similar = await findSimilarByContent(db, content ?? "", ctx.cwd);
          if (similar.found) {
            const pct = (similar.similarity * 100).toFixed(1);
            return {
              content: [{
                type: "text" as const,
                text: `✅ Found existing summary — Content similarity ${pct}%\n\n**Title:** ${similar.title}\n**Path:** ${similar.path}\n**URL:** ${url}`,
              }],
              details: { found: true, matchType: "content_similarity", path: similar.path, title: similar.title, similarity: similar.similarity },
            };
          }

          return {
            content: [{ type: "text" as const, text: `📭 No existing summary found for ${url}. Proceed with fetch_url.` }],
            details: { found: false, notFoundReason: "no-match" },
          };
        } finally {
          db.close();
        }
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error("[find_existing_summary] Error:", msg);
        return {
          content: [{ type: "text" as const, text: `⚠️ Error checking for existing summary: ${msg.slice(0, 200)}` }],
          details: { found: false, error: msg },
        };
      }
    },
  });
}
