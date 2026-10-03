/**
 * batch_create_para_docs — creates multiple PARA documents in one call,
 * indexes all in DuckDB, then runs batch semantic linking across them.
 *
 * Tools provided:
 *   batch_create_para_docs  — create N documents, index them, auto-link
 *
 * DB connection management delegates to para-knowledge/db.ts (withDb)
 * for concurrent-write safety (retry queue, lock detection, TX recovery).
 */

import { Type } from "typebox";

import {
  validateDocuments,
  buildSkippedNote,
  createFilesOnDisk,
  indexDocumentsInDb,
  autoLinkBatch,
} from "./batch-helpers.js";
import { validateCitations } from "../../common/citation-validation.js";
import { getKnowledgeConfig } from "../../common/env.js";
import { ensureNotesDb } from "../../common/notesDb.js";

import type { BatchDoc, CitationViolation, CreatedFile, ValidationError } from "./batch-helpers.js";
import type { SqliteDb } from "../para-knowledge/sqlite-types.js";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

// ── Execute helpers (reduce cyclomatic complexity) ─────────────────────

function findCitationViolations(docs: BatchDoc[], db: SqliteDb): CitationViolation[] {
  const violations: CitationViolation[] = [];
  for (const doc of docs) {
    const vr = validateCitations(doc.content, db);
    if (!vr.valid) {
      violations.push({ title: doc.title, missing: vr.missing });
    }
  }
  return violations;
}

function buildCreatedSummary(
  created: Array<{ relPath: string; title: string }>,
  linkNote: string,
  skippedNote: string,
): string {
  const lines = created.map((c) => `  • ${c.relPath} — ${c.title}`).join("\n");
  return `✅ Created and indexed ${created.length} documents:${linkNote}${skippedNote}\n\n${lines}`;
}

async function createAndIndexAll(
  docs: BatchDoc[],
  knowledgeDir: string,
  cwd: string,
): Promise<Array<{ path: string; title: string; relPath: string }>> {
  const created = await createFilesOnDisk(docs, knowledgeDir);
  await indexDocumentsInDb(docs, created, cwd);
  return created;
}

/** Early response when atomicity validation rejected every document. */
function noValidDocsResponse(validationErrors: ValidationError[]): {
  content: Array<{ type: "text"; text: string }>;
  details: Record<string, unknown>;
} {
  const lines = validationErrors.map((e) => `  • "${e.title}": ${e.message}`).join("\n");
  return {
    content: [
      {
        type: "text" as const,
        text: `❌ All ${validationErrors.length} document(s) failed atomicity validation:\n\n${lines}`,
      },
    ],
    details: { error: "ALL_ATOMICITY_VIOLATIONS", validationErrors },
  };
}

/** Run batch auto-linking with error tolerance; returns linked count (-1 on failure). */
async function runAutoLinkBatch(
  doAutoLink: boolean,
  validDocs: BatchDoc[],
  created: CreatedFile[],
  cwd: string,
  warn: (text: string) => void,
): Promise<number> {
  if (!doAutoLink) return 0;
  try {
    return await autoLinkBatch(validDocs, created, cwd);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[batch-create] Auto-link error:", msg);
    warn(`⚠️  Auto-linking error: ${msg.slice(0, 200)}.`);
    return -1;
  }
}

/** Warning note for docs created without atomicity verification. */
function buildWarningNote(warnings: ValidationError[]): string {
  if (warnings.length === 0) return "";
  return (
    `\n⚠️  ${warnings.length} document(s) created WITHOUT atomicity verification:\n` +
    warnings.map((w) => `  • "${w.title}": ${w.message}`).join("\n")
  );
}

/** Note describing how many docs were decomposed into atomic splits. */
function buildExpansionNote(expandedCount: number, errorCount: number): string {
  if (expandedCount === 0) return "";
  return `\n📐 Decomposed ${errorCount} document(s) into ${expandedCount} atomic notes`;
}

function buildCitationErrorResponse(violations: CitationViolation[]): {
  content: Array<{ type: "text"; text: string }>;
  details: Record<string, unknown>;
} {
  const lines = violations
    .map((v) => `  • "${v.title}": unresolved citekey(s) — ${v.missing.join(", ")}`)
    .join("\n");
  return {
    content: [
      {
        type: "text" as const,
        text:
          `❌ Citation validation failed — ${violations.length} document(s) have unresolved citations. ` +
          `Call \`resolve_citation\` for each missing citekey before retrying.\n\n${lines}`,
      },
    ],
    details: { error: "CITATION_VIOLATIONS", citationViolations: violations },
  };
}

// ── Tool registration ─────────────────────────────────────────────────

export default function (pi: ExtensionAPI): void {
  pi.registerTool({
    name: "batch_create_para_docs",
    label: "Batch Create PARA Docs",
    description:
      "Create multiple PARA knowledge documents (markdown + YAML frontmatter) in one call, " +
      "index all of them in notes.db, and run batch auto-linking across them. " +
      "Files are written to KNOWLEDGE_DIR (from .env), not the current working directory. " +
      "Each document follows: PARA classification — Resources (reference/theory), Areas (responsibilities/skills), " +
      "Projects (deliverables/practical work). " +
      "Atomic principle — one key idea per note (one research question + one indicative answer). " +
      "Validates atomicity (single coherent topic — one research question and one indicative answer) and citation references for each doc before creation. " +
      "Filenames auto-generated as kebab-case slug from title. " +
      "Citations: Pandoc-style @citekey (narrative) or [@citekey] (parenthetical) from @ref.bib. " +
      "Run list_para_tags first and reuse existing tags. " +
      "Provide short description ≤ 200 chars for better BM25 search. " +
      "Recommended body: ## Summary (2-4 paragraphs), ## Key Points, ## Sources.",
    promptSnippet:
      "Batch-create multiple PARA docs with auto-linking, validating atomicity and following citation conventions",
    promptGuidelines: [
      "Use batch_create_para_docs when creating 3+ related documents to save tool calls and enable batch auto-linking.",
      "Each document in the array has: title, content, tags, area (Resources/Projects/Areas), optional description, optional source.",
      "After creation, the tool auto-links all documents in the batch to each other using BM25 semantic similarity.",
      "Follow PARA conventions: Resources for reference/theory, Areas for responsibilities, Projects for practical work.",
      "Use Pandoc-style citations (@citekey / [@citekey]) referencing @ref.bib for any sourced claims.",
      "Apply atomic principle: one key idea per document (one research question + one indicative answer), keep concise.",
      "Each document is validated for atomicity before creation; violating documents are rejected individually.",
      "Citations are validated: all @citekey references must exist in notes.db. If any doc has unresolved citations, the entire batch is rejected.",
    ],
    parameters: Type.Object({
      documents: Type.Array(
        Type.Object({
          title: Type.String({ description: "Document title" }),
          content: Type.String({ description: "Markdown body content" }),
          tags: Type.Array(Type.String(), { description: "Tags for frontmatter" }),
          area: Type.Optional(
            Type.String({
              description:
                'PARA category: "Areas", "Projects", or "Resources" (default: "Resources")',
            }),
          ),
          description: Type.Optional(
            Type.String({ description: "Short summary ≤ 200 characters, enriches BM25 search" }),
          ),
          source: Type.Optional(Type.String({ description: "Original source URL (optional)" })),
        }),
        { description: "Array of documents to create" },
      ),
      autoLink: Type.Optional(
        Type.Boolean({
          description:
            "Whether to run semantic auto-linking across the batch after creation (default: true)",
        }),
      ),
    }),

    async execute(_toolCallId, params, _signal, onUpdate, ctx) {
      const docs = params.documents as BatchDoc[];
      const doAutoLink = params.autoLink !== false;
      const { dir: knowledgeDir } = getKnowledgeConfig(ctx.cwd);

      // Atomicity validation with auto-expansion
      const {
        validDocs,
        validationErrors,
        warnings = [],
        expandedCount,
      } = await validateDocuments(docs, ctx.model!);

      if (validDocs.length === 0) return noValidDocsResponse(validationErrors);

      // Citation validation — reject the batch when any citekey is unresolved
      const db = await ensureNotesDb(ctx.cwd);
      const citationViolations = findCitationViolations(docs, db);
      if (citationViolations.length > 0) {
        return buildCitationErrorResponse(citationViolations);
      }

      // Step 1+2: Create files on disk and index in DB
      let created;
      try {
        created = await createAndIndexAll(validDocs, knowledgeDir, ctx.cwd);
        onUpdate?.({
          content: [
            { type: "text", text: `📝 Created ${created.length} files. Indexing in notes.db…` },
          ],
          details: {},
        });
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error("[batch-create] Create/index error:", msg);
        onUpdate?.({
          content: [
            {
              type: "text",
              text: `⚠️  File creation or indexing failed: ${msg.slice(0, 200)}.`,
            },
          ],
          details: {},
        });
        return {
          content: [
            {
              type: "text",
              text: `Created documents may exist. DB indexing failed — will sync on next search.`,
            },
          ],
          details: { error: "CREATE_OR_INDEX_FAILED" },
        };
      }

      // Step 3: Auto-link across the batch (error-tolerant)
      if (doAutoLink) {
        onUpdate?.({
          content: [{ type: "text", text: "🔗 Running batch semantic auto-linking…" }],
          details: {},
        });
      }
      const warn = (text: string): void => {
        onUpdate?.({ content: [{ type: "text" as const, text }], details: {} });
      };
      const linkedCount = await runAutoLinkBatch(doAutoLink, validDocs, created, ctx.cwd, warn);

      const notes =
        buildSkippedNote(validationErrors) +
        buildExpansionNote(expandedCount, validationErrors.length) +
        buildWarningNote(warnings);
      const linkNote = doAutoLink
        ? `\n🔗 Auto-linked: ${linkedCount}/${created.length} documents received markdown links`
        : "";

      return {
        content: [
          {
            type: "text",
            text: buildCreatedSummary(created, linkNote, notes),
          },
        ],
        details: {
          created: created.map((c) => ({ path: c.path, title: c.title, relPath: c.relPath })),
          count: created.length,
          autoLinked: doAutoLink,
          linkedCount,
          expandedCount,
          validationErrors: validationErrors.length > 0 ? validationErrors : undefined,
          warnings: warnings.length > 0 ? warnings : undefined,
        },
      };
    },
  });
}
