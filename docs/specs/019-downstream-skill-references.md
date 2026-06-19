---
title: Downstream Skill References
description: Update text references in create-doc, knowledge, research, summarize-link skills and batch-create/search.ts JSDoc to use markdown links instead of wikilinks.
status: proposed
remaining: 1
date: 2026-06-19
---

# Requirements Specification

Functional requirements:

**create-doc/SKILL.md:**
- Section 3 ("Resolve citations") rule: change "Existing PARA notes don't need BibTeX entries — just use `[[wikilink]]`" to "Existing PARA notes don't need BibTeX entries — just use `[title](path)` markdown links"
- Section 7 ("Cross-reference with wikilinks"): rename to "Cross-reference with markdown links"; change all `[[wikilink]]` references to `[title](path)` format
- Section "Recommended body structure": change template from `- [[wikilink to related existing note]]` to `- [Related Note Title](path/to/note.md)`

**knowledge/SKILL.md:**
- Step 3: change "append `[[wikilinks]]`" to "append `[title](path)` markdown links"

**research/SKILL.md:**
- Step 7 template: change `- **[Idea 1]** — [[wikilink to note 1]]` to `- **[Idea 1]** — [Note Title](Resources/note-title.md)`
- Step 8: change "append [[wikilinks]]" to "append markdown links"

**summarize-link/SKILL.md:**
- Step 5: change "append `[[wikilinks]]`" to "append `[title](path)` markdown links"

**batch-create/search.ts:**
- Line 2 JSDoc: change "FTS5-based semantic search and [[wikilink]] appending" to "FTS5-based semantic search and [title](path) markdown link appending"

Non-functional requirements:
- All changes are purely text/instructional — no logic changes to any tool or function
- The create-doc skill must continue to delegate to auto-link for post-creation linking (the tool call doesn't change)

# Design Principles

- Each skill file change is minimal — only update the text that references wikilinks
- The create-doc skill's section 7 is the most substantive change: it defines the cross-reference format for new notes
- The research skill's executive summary template is the most visible template change

# References

- ADR 007: @docs/ADR/007-markdown-link-format-for-para-cross-references.md
- ADR 008: @docs/ADR/008-auto-link-skill-output-migration.md
- `skills/create-doc/SKILL.md`
- `skills/knowledge/SKILL.md`
- `skills/research/SKILL.md`
- `skills/summarize-link/SKILL.md`
- `extensions/batch-create/search.ts`

This spec implements @docs/ADR/008-auto-link-skill-output-migration.md
