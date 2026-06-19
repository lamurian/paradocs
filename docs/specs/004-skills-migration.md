---
title: Skills Migration
description: Migrate all 8 skills from Cognoscere .agents/skills/ to paradocs skills/.
date: 2026-06-18
status: implemented
---

# Requirements Specification

- Migrate 8 skills from Cognoscere `.agents/skills/` to paradocs `skills/`
- Each skill is a directory containing a `SKILL.md` file with frontmatter
- Update any tool references in SKILL.md that changed migration path (none expected — tool names remain the same)
- Preserve all SKILL.md frontmatter (name, description, dependencies)

## File Mapping

| Source (Cognoscere) | Destination (paradocs) | Purpose |
|---|---|---|
| `.agents/skills/knowledge/SKILL.md` | `skills/knowledge/SKILL.md` | Q&A workflow over PARA docs |
| `.agents/skills/create-doc/SKILL.md` | `skills/create-doc/SKILL.md` | Single source of truth for doc creation |
| `.agents/skills/web-search/SKILL.md` | `skills/web-search/SKILL.md` | Tier selection, category mapping |
| `.agents/skills/summarize-link/SKILL.md` | `skills/summarize-link/SKILL.md` | URL → summarize → create → auto-link |
| `.agents/skills/brainstorm/SKILL.md` | `skills/brainstorm/SKILL.md` | Clarify vague questions via dialogue |
| `.agents/skills/auto-link/SKILL.md` | `skills/auto-link/SKILL.md` | [[wikilink]] after note creation |
| `.agents/skills/research/SKILL.md` | `skills/research/SKILL.md` | Iterative academic research pipeline |
| `.agents/skills/roadmap/SKILL.md` | `skills/roadmap/SKILL.md` | Structured learning pathway |

## Tool Name Verification

Skills reference tools by registered name. Verify these still match after migration:
- `search_para_docs` (para-knowledge)
- `create_para_doc` (para-knowledge)
- `update_para_doc` (para-knowledge)
- `list_para_tags` (para-knowledge)
- `find_existing_summary` (para-knowledge)
- `resolve_citation` (para-knowledge)
- `web_search` (web-search)
- `fetch_url` (link-summarizer)
- `batch_create_para_docs` (batch-create)

All tool names remain unchanged from Cognoscere — no SKILL.md edits required.

# Design Principles

- **Copy exactly**: SKILL.md files migrate byte-for-byte.
- **No rename needed**: Tool names are stable across the migration.
- **Skills remain the workflow layer**: They chain tools; tools live in extensions.

# References

- ADR 001: Migration Architecture

This spec implements @docs/ADR/001-*.md
