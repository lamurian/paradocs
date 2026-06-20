---
title: Link Format Specification
description: Defines the [title](path.md) markdown link format for PARA cross-references, including title resolution from SQLite files table, path construction, and migration rules.
status: implemented
remaining: 0
date: 2026-06-19
---

# Requirements Specification

Functional requirements:
- The link format MUST be standard Markdown: `[Display Title](path-from-knowledge-dir.md)`
- The display title MUST be resolved from the SQLite `files` table by querying `SELECT title FROM files WHERE path = ?`
- If the path is not found in the `files` table, fall back to extracting the filename stem (slug) from the path: `p.replace(/\.md$/, "").split("/").pop()`
- The path MUST be the full relative path from the knowledge base root directory, including the PARA area prefix (e.g., `Resources/note-title.md`)
- The `.md` extension MUST be included in the path for direct rendering compatibility
- This format applies to all "Relevant notes" sections, template placeholders, and link output across all skills and extensions
- The batch-create extension already generates this format — its code is the reference implementation

Non-functional requirements:
- Zero database migration needed (the `files` table already stores `path` and `title`)
- Title resolution must be performant — single indexed PK lookup by path
- Must render correctly in any standard Markdown viewer without tool-specific parsing

# Design Principles

- The `files` table uses `path` as PRIMARY KEY, so title lookups are O(1) indexed lookups
- Reference implementation: `extensions/batch-create/search.ts` `appendLinks()` lines 92-93:
  ```ts
  const row = db.get<{ title: string }>("SELECT title FROM files WHERE path = ?", p);
  const title = row?.title?.trim() || (p.replace(/\.md$/, "").split("/").pop() ?? "");
  return `[${title}](${p})`;
  ```
- All skills and extensions that produce or reference cross-references must use this format

# References

- ADR 007: @docs/ADR/007-markdown-link-format-for-para-cross-references.md

This spec implements @docs/ADR/007-markdown-link-format-for-para-cross-references.md
