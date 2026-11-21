/**
 * stage_para_docs — validate block-structured notes and write a staging batch.
 *
 * This is the only write path available to read-only processes. It never
 * touches KNOWLEDGE_DIR, notes.db or ref.bib; ingest consumes the outbox later.
 *
 * @module extensions/para-outbox/stage-tool
 */

import { existsSync } from "node:fs";
import { join } from "node:path";

import { Type } from "typebox";

import { loadParadocsConfig } from "../../common/config.ts";
import { configureEnv, getKnowledgeConfig } from "../../common/env.ts";
import { renderNote } from "../../common/note-render.ts";
import { openNotesDbReadOnly } from "../../common/notesDb.ts";
import { sha256File, writeOutboxBatch } from "../../common/outbox.ts";
import { slugify } from "../../common/slug.ts";
import {
  findDuplicateTitle,
  loadKnownCitekeys,
  validateStagedNote,
} from "../../common/stage-validate.ts";

import type { OutboxNote } from "../../common/outbox.ts";
import type { StageNoteInput, StagedCitation } from "../../common/stage-validate.ts";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/** Parameters accepted by stage_para_docs. */
export interface StageParams {
  notes: StageNoteInput[];
  citations?: StagedCitation[];
}

/** One staged note summary returned to the caller. */
export interface StagedNoteSummary {
  file: string;
  title: string;
  mode: "create" | "update";
  targetPath: string;
  contentLines: number;
  baseHash: string | null;
}

/** Result of a staging run. */
export interface StageResult {
  ok: boolean;
  batchId: string | null;
  dir: string | null;
  errors: string[];
  notes: StagedNoteSummary[];
}

/** Typebox schema for a single staged note. */
const noteSchema = Type.Object({
  mode: Type.Union([Type.Literal("create"), Type.Literal("update")], {
    description: "Create a new note or update an existing one.",
  }),
  targetPath: Type.Optional(
    Type.String({ description: "KB-relative target path; required for updates." }),
  ),
  title: Type.String(),
  description: Type.String({ description: "Brief summary, 200 characters or fewer." }),
  tags: Type.Array(Type.String({ description: "Kebab-case tag." })),
  area: Type.Union([Type.Literal("Resources"), Type.Literal("Areas"), Type.Literal("Projects")]),
  summary: Type.Array(
    Type.String({ description: "Summary paragraph or table row; never raw markdown." }),
  ),
  keyPoints: Type.Array(Type.String({ description: "Key point bullet text." })),
  reviewed: Type.Optional(Type.String()),
  reviewInterval: Type.Optional(Type.Number()),
});

/** Typebox schema for a staged citation. */
const citationSchema = Type.Object({
  citekey: Type.String(),
  bibtex: Type.String(),
  published: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  verified_at: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  trust_class: Type.Optional(Type.Union([Type.String(), Type.Null()])),
});

/**
 * Validate, render and stage a batch of notes for the given working directory.
 *
 * Every note is rendered and validated first. Any validation error aborts the
 * whole batch with no files written.
 *
 * @param cwd - Project working directory that owns the outbox.
 * @param params - Notes and citations supplied to stage_para_docs.
 * @returns Batch id and per-note summaries, or all validation errors.
 */
export function stageParaDocs(cwd: string, params: StageParams): StageResult {
  configureEnv(cwd);

  const knowledgeDir = getKnowledgeConfig(cwd).dir;
  const { config } = loadParadocsConfig(knowledgeDir);
  const db = openNotesDbReadOnly(cwd);

  const citations = params.citations ?? [];
  const knownCitekeys = loadKnownCitekeys(db, knowledgeDir);
  const stagedCitekeys = new Set(citations.map((citation) => citation.citekey));
  const now = new Date();

  const rendered = params.notes.map((input) =>
    renderNote(input, { wrapWidth: config.note.wrapWidth, now }),
  );

  const errors: string[] = [];
  params.notes.forEach((input, index) => {
    const validation = validateStagedNote(input, rendered[index], {
      knownCitekeys,
      stagedCitekeys,
      maxContentLines: config.note.maxContentLines,
      findDuplicate: (title) => (db === null ? null : findDuplicateTitle(db, title)),
      targetExists: (path) => existsSync(join(knowledgeDir, path)),
    });
    for (const error of validation) {
      errors.push(`${input.title}: ${error}`);
    }
  });

  if (errors.length > 0) {
    return { ok: false, batchId: null, dir: null, errors, notes: [] };
  }

  const outboxNotes: OutboxNote[] = params.notes.map((input, index) => {
    const targetPath = input.mode === "update" ? (input.targetPath ?? "") : "";
    const baseHash = input.mode === "update" ? sha256File(join(knowledgeDir, targetPath)) : null;
    return { input, rendered: rendered[index], baseHash };
  });

  const { batchId, dir } = writeOutboxBatch(cwd, { notes: outboxNotes, citations });

  const notes: StagedNoteSummary[] = outboxNotes.map((note) => {
    const slug = slugify(note.input.title);
    return {
      file: `notes/${slug}.md`,
      title: note.input.title,
      mode: note.input.mode,
      targetPath:
        note.input.mode === "create"
          ? `${note.input.area}/${slug}.md`
          : (note.input.targetPath ?? ""),
      contentLines: note.rendered.contentLines,
      baseHash: note.baseHash,
    };
  });

  return { ok: true, batchId, dir, errors: [], notes };
}

/** Format the tool output for a successful batch. */
function formatSuccess(result: StageResult): string {
  const lines = [`Staged batch ${result.batchId} in ${result.dir}`, ""];
  for (const note of result.notes) {
    lines.push(`- ${note.title} -> ${note.targetPath} (${note.mode})`);
    lines.push(`  file: ${note.file}`);
    lines.push(`  content lines: ${note.contentLines}`);
    if (note.baseHash !== null) lines.push(`  baseHash: ${note.baseHash}`);
  }
  lines.push("");
  lines.push("Ingest runs automatically at the end of implementation.");
  return lines.join("\n");
}

/**
 * Register the stage_para_docs tool.
 *
 * @param pi - The pi extension API.
 */
export function registerStageTool(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "stage_para_docs",
    label: "Stage PARA Docs",
    description:
      "Validate block-structured PARA notes and stage them in the project outbox " +
      "(.pi/paradocs/outbox/<batchId>/). Ingest writes the knowledge base later.",
    promptSnippet: "Stage structured PARA notes in the project outbox for ingest",
    promptGuidelines: [
      "Use stage_para_docs with notes as block input: summary paragraphs and key points, never raw markdown.",
      "stage_para_docs wraps summary and key points at 80 columns automatically; the content cap is 60 lines.",
      "Cite sources in stage_para_docs with @citekey from resolve_citation previews passed in citations.",
      "Ingest happens at the end of implementation; do not write KNOWLEDGE_DIR files directly.",
    ],
    parameters: Type.Object({
      notes: Type.Array(noteSchema, { minItems: 1 }),
      citations: Type.Optional(Type.Array(citationSchema)),
    }),

    execute(_toolCallId, params, _signal, onUpdate, ctx) {
      onUpdate?.({
        content: [{ type: "text" as const, text: "Staging PARA notes…" }],
        details: {},
      });

      const result = stageParaDocs(ctx.cwd, params);

      if (!result.ok) {
        return Promise.resolve({
          content: [
            {
              type: "text" as const,
              text: `Staging failed with ${result.errors.length} error(s):\n\n${result.errors
                .map((error) => `- ${error}`)
                .join("\n")}`,
            },
          ],
          details: { ...result },
        });
      }

      return Promise.resolve({
        content: [{ type: "text" as const, text: formatSuccess(result) }],
        details: { ...result },
      });
    },
  });
}
