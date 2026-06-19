---
title: Update Downstream Skill Files
description: Update create-doc, knowledge, research, summarize-link skills and batch-create/search.ts JSDoc to reference markdown links.
status: {{status}}
date: 2026-06-19
---

# Overview

Five files reference `[[wikilink]]` in their documentation/templates. These must be updated to `[title](path.md)` format to match ADR 007.

# Goals

- create-doc/SKILL.md: sections 3, 7, and "Recommended body structure" updated
- knowledge/SKILL.md: step 3 updated
- research/SKILL.md: step 7 template and step 8 updated
- summarize-link/SKILL.md: step 5 updated
- batch-create/search.ts: line 2 JSDoc updated

# Implementation Steps

- [ ] Edit `skills/create-doc/SKILL.md`:
  - [ ] Section 3: "just use `[[wikilink]]`" → "just use `[title](path)` markdown links"
  - [ ] Section 7: Rename "Cross-reference with wikilinks" → "Cross-reference with markdown links"; update format description
  - [ ] "Recommended body structure": `- [[wikilink to related existing note]]` → `- [Related Note](path/to/note.md)`
- [ ] Edit `skills/knowledge/SKILL.md`:
  - [ ] Step 3: "append `[[wikilinks]]`" → "append `[title](path)` markdown links"
- [ ] Edit `skills/research/SKILL.md`:
  - [ ] Step 7 template: `[[wikilink to note 1]]` → `[Note Title](Resources/note-title.md)`
  - [ ] Step 8: "append [[wikilinks]]" → "append markdown links"
- [ ] Edit `skills/summarize-link/SKILL.md`:
  - [ ] Step 5: "append `[[wikilinks]]`" → "append `[title](path)` markdown links"
- [ ] Edit `extensions/batch-create/search.ts`:
  - [ ] Line 2 JSDoc: "[[wikilink]] appending" → "markdown link appending"

# Risks

None — pure text replacement, no logic changes.

# UAT

1. Run `grep -rn '\[\[\|wikilink' skills/ extensions/` and confirm no remaining wikilink references in the targeted files
2. Open each edited file and verify replacements are contextually correct

This plan implements @docs/specs/019-downstream-skill-references.md
