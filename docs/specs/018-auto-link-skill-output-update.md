---
title: Auto-Link Skill Output Update
description: Rewrite auto-link/SKILL.md steps 3, 6, and 7 to output [title](path.md) format instead of [[slug]].
status: proposed
remaining: 1
date: 2026-06-19
---

# Requirements Specification

Functional requirements:
- The auto-link skill MUST keep its existing 7-step workflow (read → extract concepts → search candidates → LLM evaluate → select top → append links → confirm)
- The LLM-based semantic matching logic and evaluation criteria MUST remain unchanged
- **Step 3 (search candidates):** Change exclusion logic from filtering by slug to filtering by full document path against the new note's path
- **Step 6 (append links):** Change the "Relevant notes" section format from `- [[slug]]` to `- [Title](path.md)` using title resolution from the SQLite `files` table
- **Step 6:** The dedup comparison must compare paths (not slugs) when checking existing links
- **Step 7 (confirm):** Change confirmation message format from `- [[slug]] — reason` to `- [Title](path) — reason`
- The "Important" note about `[[slug]]` format MUST be rewritten to describe `[title](path.md)` format
- The description field MUST be updated: "appends [[wikilinks]]" → "appends markdown links"
- The skill description in frontmatter (line 3) MUST be updated

Non-functional requirements:
- Title resolution must use the same `SELECT title FROM files WHERE path = ?` pattern as batch-create extension
- Must handle the case where a target note exists on disk but hasn't been indexed in SQLite (fall back to slug)
- The "Relevant notes" section must maintain the same dedup behaviour (skip already-listed links)

# Design Principles

- Reference implementation pattern: same as `extensions/batch-create/search.ts` `appendLinks()` lines 80-93
- The slug exclusion in step 3 changes to path-based exclusion:
  - Old: "filter out any slug matching the new note's slug"
  - New: "filter out any path matching the new note's path"
- The "Relevant notes" section output format changes from:
  ```markdown
  - [[selected-note-slug]]
  - [[another-selected-note]]
  ```
  to:
  ```markdown
  - [Selected Note Title](Resources/selected-note-slug.md)
  - [Another Note Title](Resources/another-selected-note.md)
  ```

# References

- ADR 007: @docs/ADR/007-markdown-link-format-for-para-cross-references.md
- ADR 008: @docs/ADR/008-auto-link-skill-output-migration.md
- `extensions/batch-create/search.ts` (reference implementation)
- `skills/auto-link/SKILL.md` (target file)

This spec implements @docs/ADR/008-auto-link-skill-output-migration.md
