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

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { slugify, formatFrontmatter } from "./yaml.js";
import { createDb, initDb, indexFile } from "../para-knowledge/db-sqlite.js";
import type { DocIndex } from "../para-knowledge/db-sqlite.js";
import { findRelated, appendLinks } from "./search.js";

// ── Types ─────────────────────────────────────────────────────────────

interface BatchDoc {
  title: string;
  content: string;
  tags: string[];
  area?: string;
  description?: string;
  source?: string;
}

interface CreatedFile {
  path: string;
  title: string;
  relPath: string;
}

// ── Step 1: Create all files on disk ──────────────────────────────────

async function createFilesOnDisk(docs: BatchDoc[], cwd: string): Promise<CreatedFile[]> {
  const created: CreatedFile[] = [];

  for (let i = 0; i < docs.length; i++) {
    const doc = docs[i];
    const area = doc.area ?? "Resources";
    const dirPath = resolve(cwd, area);
    const slug = slugify(doc.title);
    const filePath = join(dirPath, `${slug}.md`);
    const relPath = `${area}/${slug}.md`;
    const now = new Date().toISOString();

    const frontmatterFields: Record<string, unknown> = {
      title: doc.title,
      author: "pi",
      editor: "lam",
      date: now,
      tags: doc.tags,
    };
    if (doc.description?.trim()) frontmatterFields.description = doc.description.trim();
    if (doc.source?.trim()) frontmatterFields.source = doc.source.trim();

    const fm = formatFrontmatter(frontmatterFields);
    await mkdir(dirPath, { recursive: true });
    await writeFile(filePath, fm + "\n" + doc.content, "utf-8");

    created.push({ path: filePath, title: doc.title, relPath });
  }

  return created;
}

// ── Step 2: Index all documents in SQLite ────────────────────────────

async function indexDocumentsInDb(
  docs: BatchDoc[],
  created: CreatedFile[],
  cwd: string,
): Promise<void> {
  const dbPath = resolve(cwd, "notes.db");
  const db = createDb(dbPath);
  initDb(db);
  try {
    for (let i = 0; i < docs.length; i++) {
      const doc = docs[i];
      const relPath = created[i].relPath;
      const docIndex: DocIndex = {
        path: relPath,
        title: doc.title,
        body: (doc.description ?? "") + "\n" + doc.content,
        tags: doc.tags,
        author: "pi",
        editor: "lam",
        created: new Date().toISOString(),
        modified: new Date().toISOString(),
        file_mtime: new Date().toISOString(),
        source_url: doc.source ?? null,
      };
      indexFile(db, docIndex);
    }
  } finally {
    db.close();
  }
}

// ── Step 3: Auto-link across the batch ────────────────────────────────

async function autoLinkBatch(
  docs: BatchDoc[],
  created: CreatedFile[],
  cwd: string,
): Promise<number> {
  const dbPath = resolve(cwd, "notes.db");
  const db = createDb(dbPath);
  initDb(db);
  try {
    let linkedCount = 0;
    for (let i = 0; i < docs.length; i++) {
      const doc = docs[i];
      const relPath = created[i].relPath;
      const related = await findRelated(db, relPath, doc.title, doc.tags, 5);
      if (related.length > 0) {
        await appendLinks(created[i].path, related);
        linkedCount++;
      }
    }
    return linkedCount;
  } finally {
    db.close();
  }
}

// ── Tool registration ─────────────────────────────────────────────────

export default function (pi: ExtensionAPI): void {
  pi.registerTool({
    name: "batch_create_para_docs",
    label: "Batch Create PARA Docs",
    description:
      "Create multiple PARA knowledge documents (markdown with YAML frontmatter) in one call, " +
      "index all of them in notes.db, and run semantic auto-linking across the batch. " +
      "Fundamental/reference content should go in Resources/; practical content in Projects/.",
    promptSnippet: "Create several PARA documents at once, index them, and auto-link them",
    promptGuidelines: [
      "Use batch_create_para_docs when creating 3+ related documents to save tool calls and enable batch auto-linking.",
      "Each document in the array has: title, content, tags, area (Resources/Projects/Areas), optional description, optional source.",
      "After creation, the tool auto-links all documents in the batch to each other using BM25 semantic similarity.",
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
      const docs = params.documents;
      const autoLink = params.autoLink !== false;
      const cwd = ctx.cwd;

      // Step 1: Create files on disk
      let created: CreatedFile[];
      try {
        created = await createFilesOnDisk(docs, cwd);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        return {
          content: [{ type: "text", text: `❌ File creation failed: ${msg}` }],
          details: { error: "CREATE_FAILED" },
        };
      }

      onUpdate?.({
        content: [
          { type: "text", text: `📝 Created ${created.length} files. Indexing in notes.db…` },
        ],
        details: {},
      });

      // Step 2: Index in DuckDB (withDb handles lock retry + recovery)
      try {
        await indexDocumentsInDb(docs, created, cwd);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error("[batch-create] DuckDB indexing error:", msg);
        onUpdate?.({
          content: [
            {
              type: "text",
              text: `⚠️  Files created but DuckDB indexing failed: ${msg.slice(0, 200)}.`,
            },
          ],
          details: {},
        });
        return {
          content: [
            {
              type: "text",
              text: `Created ${created.length} documents. DB indexing failed — will sync on next search.`,
            },
          ],
          details: { created: created.map((c) => c.path), autoLinked: false },
        };
      }

      // Step 3: Auto-link across the batch
      let linkedCount = 0;
      if (autoLink) {
        onUpdate?.({
          content: [{ type: "text", text: "🔗 Running batch semantic auto-linking…" }],
          details: {},
        });

        try {
          linkedCount = await autoLinkBatch(docs, created, cwd);
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : String(e);
          console.error("[batch-create] Auto-link error:", msg);
          onUpdate?.({
            content: [{ type: "text", text: `⚠️  Auto-linking error: ${msg.slice(0, 200)}.` }],
            details: {},
          });
        }
      }

      const linkNote = autoLink
        ? `\n🔗 Auto-linked: ${linkedCount}/${created.length} documents received [[wikilinks]]`
        : "";
      const lines = created.map((c) => `  • ${c.relPath} — ${c.title}`).join("\n");

      return {
        content: [
          {
            type: "text",
            text: `✅ Batch created and indexed ${created.length} documents:${linkNote}\n\n${lines}`,
          },
        ],
        details: {
          created: created.map((c) => ({ path: c.path, title: c.title, relPath: c.relPath })),
          count: created.length,
          autoLinked: autoLink,
          linkedCount,
        },
      };
    },
  });
}
