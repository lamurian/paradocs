/**
 * Knowledge base write-back — routes research results into PARA notes.
 *
 * Resolves citations for each unique source URL, uses one LLM call to group
 * sources into atomic notes and detect outdated existing notes, then routes:
 * outdated notes → read/merge/reindex under KNOWLEDGE_DIR, new notes →
 * batch-create path (atomicity + citation validation, create, index, auto-link).
 *
 * @module extensions/research-engine/writeback
 */

import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { validateCitations } from "../../common/citation-validation.js";
import { resolveCitation } from "../../common/citation.js";
import { configureEnv, getKnowledgeConfig } from "../../common/env.js";
import { extractJson } from "../../common/extractJson.js";
import { callLlmDirect } from "../../common/llm.js";
import { ensureNotesDb } from "../../common/notesDb.js";
import {
  validateDocuments,
  createFilesOnDisk,
  indexDocumentsInDb,
  autoLinkBatch,
} from "../batch-create/batch-helpers.js";
import { searchDocs, indexFile } from "../para-knowledge/db-sqlite.js";
import { parseFrontmatter, formatFrontmatter } from "../para-knowledge/frontmatter.js";

import type { ResearchResult, ResearchSource, WritebackResult } from "./types.js";
import type { SqliteDb } from "../para-knowledge/sqlite-types.js";
import type { Api, Model } from "@earendil-works/pi-ai";

/** Minimal context surface the write-back needs from commands or tools. */
export interface WritebackContext {
  /** Working directory for env config resolution. */
  cwd: string;
  /** Active model for the grouping LLM call. */
  model?: Model<Api>;
  /** Model registry for API key resolution. */
  modelRegistry?: {
    getApiKeyAndHeaders: (
      model: Model<Api>,
    ) => Promise<{ ok: boolean; apiKey?: string; headers?: Record<string, string> }>;
  };
}

/** One grouped atomic note produced by the LLM. */
interface GroupedNote {
  title: string;
  content: string;
  tags: string[];
  area?: string;
  source?: string;
}

/** One outdated existing note detected by the LLM. */
interface GroupedOutdated {
  path: string;
  reason: string;
  content: string;
}

/** Parsed shape of the grouping LLM response. */
interface GroupingResult {
  notes: GroupedNote[];
  outdated: GroupedOutdated[];
}

/** System prompt instructing the LLM to group sources and detect outdated notes. */
export const GROUPING_PROMPT = `You group research sources into atomic knowledge base notes and detect outdated existing notes.

Return ONLY valid JSON. No markdown fences, no explanatory text.
{
  "notes": [{"title": "...", "content": "...", "tags": ["..."], "area": "Resources", "source": "url"}],
  "outdated": [{"path": "Resources/foo.md", "reason": "...", "content": "refreshed markdown body"}]
}

Rules:
- Each note covers exactly one key idea (atomic principle). Recommended body: ## Summary, ## Key Points, ## Sources.
- Cite sources in note content using @citekey notation from the resolved citations list.
- area is one of "Resources", "Areas", "Projects" (default "Resources").
- Mark an existing note outdated ONLY when the new sources supersede it; provide the refreshed markdown body in "content".
- Keep tags short and reusable.`;

/**
 * Parse and validate the grouping LLM response.
 *
 * @param text - Raw LLM response text.
 * @returns Parsed grouping result, or null when the shape is invalid.
 */
export function parseGrouping(text: string): GroupingResult | null {
  const parsed = extractJson(text);
  if (parsed === null || typeof parsed !== "object") return null;
  const obj = parsed as Partial<GroupingResult>;
  if (!Array.isArray(obj.notes) || !Array.isArray(obj.outdated)) return null;
  return { notes: obj.notes, outdated: obj.outdated };
}

/**
 * Resolve citations once per unique source URL.
 *
 * @param sources - Research sources from the engine.
 * @param cwd - Working directory for env config resolution.
 * @returns URL-to-citekey map and skipped-item notes.
 */
async function resolveAllCitations(
  sources: ResearchSource[],
  cwd: string,
): Promise<{ citekeys: Map<string, string>; skipped: string[] }> {
  const citekeys = new Map<string, string>();
  const skipped: string[] = [];
  for (const src of sources) {
    if (citekeys.has(src.url)) continue;
    const res = await resolveCitation({ source: src.url, title: src.title }, { cwd });
    if (res.citekey) citekeys.set(src.url, res.citekey);
    else skipped.push(`citation unresolved: ${src.url}`);
  }
  return { citekeys, skipped };
}

/**
 * Update an outdated note: read, merge refreshed content, reindex.
 *
 * @param note - Outdated note entry from the grouping result.
 * @param knowledgeDir - KNOWLEDGE_DIR resolved from env config.
 * @param cwd - Working directory for env config resolution.
 */
async function updateExistingNote(
  note: GroupedOutdated,
  knowledgeDir: string,
  cwd: string,
): Promise<void> {
  const filePath = resolve(knowledgeDir, note.path);
  const existing = await readFile(filePath, "utf-8");
  const fm = parseFrontmatter(existing);
  const now = new Date().toISOString();
  const title = typeof fm.title === "string" ? fm.title : note.path;
  const tags = Array.isArray(fm.tags) ? fm.tags : [];

  const newFm = formatFrontmatter({
    title,
    author: "pi",
    editor: "lam",
    date: now,
    tags,
  });
  await writeFile(filePath, newFm + "\n" + note.content, "utf-8");

  const db = await ensureNotesDb(cwd);
  indexFile(db, {
    path: note.path,
    title,
    body: note.content,
    tags,
    author: "pi",
    editor: "lam",
    created: typeof fm.date === "string" ? fm.date : now,
    modified: now,
    file_mtime: now,
    source_url: null,
  });
}

/**
 * Create new notes via the batch-create path with validation.
 *
 * @param notes - Grouped notes from the LLM.
 * @param model - Model for atomicity validation.
 * @param db - Open notes.db handle.
 * @param knowledgeDir - KNOWLEDGE_DIR resolved from env config.
 * @param cwd - Working directory for env config resolution.
 * @returns Created note paths and skipped-item notes.
 */
async function createNewNotes(
  notes: GroupedNote[],
  model: Model<Api>,
  db: SqliteDb,
  knowledgeDir: string,
  cwd: string,
): Promise<{ created: string[]; skipped: string[] }> {
  const created: string[] = [];
  const skipped: string[] = [];
  if (notes.length === 0) return { created, skipped };

  const { validDocs, validationErrors } = await validateDocuments(notes, model);
  for (const ve of validationErrors) skipped.push(`atomicity: ${ve.title}`);

  const payable: typeof validDocs = [];
  for (const doc of validDocs) {
    const vr = validateCitations(doc.content, db);
    if (vr.valid) payable.push(doc);
    else skipped.push(`unresolved citations: ${doc.title} (${vr.missing.join(", ")})`);
  }

  if (payable.length > 0) {
    const createdFiles = await createFilesOnDisk(payable, knowledgeDir);
    await indexDocumentsInDb(payable, createdFiles, cwd);
    await autoLinkBatch(payable, createdFiles, knowledgeDir);
    for (const f of createdFiles) created.push(f.relPath);
  }
  return { created, skipped };
}

/**
 * Write research results back to the knowledge base.
 *
 * @param result - Merged research result from runResearchEngine.
 * @param ctx - Context providing cwd, model, and modelRegistry.
 * @returns Paths created/updated and a list of skipped items.
 */
export async function writeBackToKB(
  result: ResearchResult,
  ctx: WritebackContext,
): Promise<WritebackResult> {
  configureEnv(ctx.cwd);
  const { dir: knowledgeDir } = getKnowledgeConfig(ctx.cwd);
  const created: string[] = [];
  const updated: string[] = [];
  const skipped: string[] = [];

  // 1. Resolve citations once per unique URL
  const citations = await resolveAllCitations(result.sources, ctx.cwd);
  skipped.push(...citations.skipped);

  // 2. Resolve auth for the grouping LLM call
  if (!ctx.model || !ctx.modelRegistry) {
    skipped.push("write-back skipped: no model selected");
    return { created, updated, skipped };
  }
  const auth = await ctx.modelRegistry.getApiKeyAndHeaders(ctx.model);
  if (!auth.ok || !auth.apiKey) {
    skipped.push("write-back skipped: no API key for model provider");
    return { created, updated, skipped };
  }

  // 3. One LLM call: group sources into notes + detect outdated notes
  const db = await ensureNotesDb(ctx.cwd);
  const kbDocs = searchDocs(db, result.questions.join(" "), {}, 10);
  const kbCtx =
    kbDocs.length === 0
      ? "No existing documents found."
      : kbDocs
          .map(
            (d) =>
              `- **${d.title}** (\`${d.path}\`)${d.created ? ` (date: ${d.created.slice(0, 10)})` : ""}: ${d.body.slice(0, 300)}`,
          )
          .join("\n");
  const sourcesStr = result.sources
    .map((s) => `- ${s.url} (@${citations.citekeys.get(s.url) ?? "unresolved"}): ${s.snippet}`)
    .join("\n");

  const grouping = await callLlmDirect<GroupingResult>(
    ctx.model,
    { apiKey: auth.apiKey, headers: auth.headers },
    GROUPING_PROMPT,
    [
      {
        type: "text",
        text: `Research sources:\n${sourcesStr}\n\nExisting KB docs:\n${kbCtx}`,
      },
    ],
    parseGrouping,
  );
  if (!grouping.ok || !grouping.value) {
    skipped.push("write-back skipped: grouping LLM call failed");
    return { created, updated, skipped };
  }

  // 4. Update outdated notes
  for (const note of grouping.value.outdated) {
    try {
      await updateExistingNote(note, knowledgeDir, ctx.cwd);
      updated.push(note.path);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      skipped.push(`update failed: ${note.path} (${msg.slice(0, 80)})`);
    }
  }

  // 5. Create new notes via the batch-create path
  const batch = await createNewNotes(grouping.value.notes, ctx.model, db, knowledgeDir, ctx.cwd);
  created.push(...batch.created);
  skipped.push(...batch.skipped);

  return { created, updated, skipped };
}
