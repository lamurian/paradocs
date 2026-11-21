/**
 * Deterministic validation for staged PARA notes.
 *
 * Validates structured note input and its rendered form before it is written
 * to the outbox. No network, LLM or filesystem writes happen here; callers
 * inject the lookup helpers they need.
 *
 * @module common/stage-validate
 */

import { loadRefBibCitekeys } from "./citation-validation.ts";
import { textSimilarity } from "../extensions/para-knowledge/similarity.ts";
import { searchDocs } from "../extensions/para-knowledge/sqlite-search.ts";
import { PARA_DIRS } from "../extensions/para-knowledge/types.ts";

import type { NoteBlocks, RenderedNote } from "./note-render.ts";
import type { SqliteDb } from "../extensions/para-knowledge/sqlite-types.ts";

/** Structured note input supplied to stage_para_docs. */
export interface StageNoteInput extends NoteBlocks {
  mode: "create" | "update";
  /** Target path such as `Resources/x.md`; required for updates. */
  targetPath?: string;
}

/** Citation metadata staged alongside a note. */
export interface StagedCitation {
  citekey: string;
  bibtex: string;
  published?: string | null;
  verified_at?: string | null;
  trust_class?: string | null;
}

/** Lookup helpers injected by the staging caller. */
export interface StageValidationContext {
  knownCitekeys: Set<string>;
  stagedCitekeys: Set<string>;
  maxContentLines: number;
  findDuplicate: (title: string) => string | null;
  targetExists: (path: string) => boolean;
}

/** Rendered note fields required for validation. */
type RenderedForValidation = Pick<RenderedNote, "contentLines" | "citekeys">;

/** Matches a lowercase kebab-case tag such as `knowledge-management`. */
const KEBAB_TAG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Maximum description length in characters. */
const MAX_DESCRIPTION_LENGTH = 200;

/** Maximum number of tags allowed on a note. */
const MAX_TAGS = 10;

/** Similarity threshold for duplicate-title detection. */
const DUPLICATE_SIMILARITY = 0.8;

/** Number of search hits considered when looking for duplicate titles. */
const DUPLICATE_SEARCH_LIMIT = 5;

/**
 * Validate the descriptive fields of a staged note.
 *
 * @param input - Structured note input.
 * @returns Validation error messages, empty when the fields are valid.
 */
function validateFields(input: StageNoteInput): string[] {
  const errors: string[] = [];

  if (input.title.trim().length === 0) {
    errors.push("title is required");
  }

  const description = input.description.trim();
  if (description.length === 0) {
    errors.push("description is required");
  } else if (description.length > MAX_DESCRIPTION_LENGTH) {
    errors.push(`description must be ${MAX_DESCRIPTION_LENGTH} characters or fewer`);
  }

  const tags = input.tags ?? [];
  const tagsValid =
    tags.length >= 1 && tags.length <= MAX_TAGS && tags.every((tag) => KEBAB_TAG_RE.test(tag));
  if (!tagsValid) {
    errors.push(`tags must be 1-${MAX_TAGS} kebab-case values`);
  }

  if (!(PARA_DIRS as readonly string[]).includes(input.area)) {
    errors.push(`invalid area: ${input.area}`);
  }

  const hasSummary = input.summary.some((paragraph) => paragraph.trim().length > 0);
  if (!hasSummary) {
    errors.push("summary is required");
  }

  return errors;
}

/**
 * Validate a staged note against the rendered output and knowledge base.
 *
 * Checks required fields, content-line limits, citekey existence, duplicate
 * titles on create and target existence on update.
 *
 * @param input - Structured note input.
 * @param rendered - Rendered note with line count and cited keys.
 * @param ctx - Lookup helpers and limits for this staging run.
 * @returns Validation error messages, empty when the note is valid.
 */
export function validateStagedNote(
  input: StageNoteInput,
  rendered: RenderedForValidation,
  ctx: StageValidationContext,
): string[] {
  const errors = validateFields(input);

  if (rendered.contentLines > ctx.maxContentLines) {
    const over = rendered.contentLines - ctx.maxContentLines;
    errors.push(
      `content is ${rendered.contentLines} lines, ${over} over the limit of ${ctx.maxContentLines}`,
    );
  }

  for (const citekey of rendered.citekeys) {
    if (ctx.knownCitekeys.has(citekey) || ctx.stagedCitekeys.has(citekey)) continue;
    errors.push(`unknown citekey @${citekey}`);
  }

  if (input.mode === "create") {
    const duplicate = ctx.findDuplicate(input.title);
    if (duplicate !== null) {
      errors.push(`a note with this title exists: ${duplicate}; stage an update instead`);
    }
  } else {
    const targetPath = input.targetPath?.trim() ?? "";
    if (targetPath.length === 0 || !ctx.targetExists(targetPath)) {
      errors.push(`update target does not exist: ${targetPath || "(missing targetPath)"}`);
    }
  }

  return errors;
}

/**
 * Find an existing note that duplicates a title.
 *
 * Searches the top five indexed hits, then accepts an exact title match or a
 * word-trigram similarity at or above 0.8.
 *
 * @param db - Open notes.db handle.
 * @param title - Candidate note title.
 * @returns Duplicate note path, or null when none is close enough.
 */
export function findDuplicateTitle(db: SqliteDb, title: string): string | null {
  const needle = title.trim().toLowerCase();
  if (needle.length === 0) return null;

  const results = searchDocs(db, title, {}, DUPLICATE_SEARCH_LIMIT);
  for (const result of results) {
    const candidate = result.title.trim();
    if (candidate.toLowerCase() === needle) return result.path;
    if (textSimilarity(title, candidate) >= DUPLICATE_SIMILARITY) return result.path;
  }

  return null;
}

/**
 * Load every citekey known to the knowledge base.
 *
 * Combines ref.bib entries with the citations table. A null database means
 * the index is unavailable, so only ref.bib keys are returned.
 *
 * @param db - Open notes.db handle, or null in read-only processes.
 * @param knowledgeDir - KNOWLEDGE_DIR containing ref.bib.
 * @returns Set of known citekeys.
 */
export function loadKnownCitekeys(db: SqliteDb | null, knowledgeDir: string): Set<string> {
  const keys = loadRefBibCitekeys(knowledgeDir);
  if (db === null) return keys;

  const rows = db.all<{ citekey: string }>("SELECT citekey FROM citations");
  for (const row of rows) {
    if (row.citekey) keys.add(row.citekey);
  }

  return keys;
}
