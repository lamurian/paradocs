---
title: Rewrite Auto-Link Skill Output
description: Edit auto-link/SKILL.md to output [title](path.md) markdown links instead of [[slug]] wikilinks while preserving LLM logic.
status: {{status}}
date: 2026-06-19
---

# Overview

The auto-link skill is the core cross-reference generator. All references to `[[wikilink]]` and `[[slug]]` must be changed to `[title](path.md)` format while keeping its 7-step LLM-driven workflow intact.

# Goals

- Description and frontmatter updated (line 3)
- Step 3 exclusion logic: slug-based → path-based
- Step 6 output format: `[[slug]]` → `[title](path.md)` with dedup by path
- Step 7 confirmation format: `[[slug]]` → `[title](path)`
- "Important" note about `[[slug]]` format replaced with `[title](path.md)` instructions
- LLM logic preserved unchanged

# Implementation Steps

- [ ] Edit `skills/auto-link/SKILL.md`:
  - [ ] Line 3 description: "appends [[wikilinks]]" → "appends markdown links"
  - [ ] Line 8: references to `[[wikilinks]]` → `[title](path)` markdown links
  - [ ] Step 3: change slug-based exclusion to path-based exclusion
  - [ ] Step 6: change output format from `- [[slug]]` to `- [Title](path.md)`
  - [ ] Step 6: change dedup from slug comparison to path comparison
  - [ ] Step 6: replace the "Important" note about `[[slug]]` with `[title](path.md)` instructions
  - [ ] Step 7: change confirmation format from `[[slug]]` to `[Title](path)`
  - [ ] Verify LLM matching logic unchanged in all steps

# Risks

| Likelihood | Impact | Mitigation |
|---|---|---|
| Medium | Low | Some instruction wording might still reference slugs — careful grep after edits |

# UAT

1. Open `skills/auto-link/SKILL.md`
2. Confirm no remaining `[[` or `]]` references in the body
3. Confirm step 6 shows `- [Title](path.md)` format
4. Confirm step 7 shows `- [Title](path)` format
5. Confirm the LLM evaluation criteria (steps 4-5) are unchanged

This plan implements @docs/specs/018-auto-link-skill-output-update.md
