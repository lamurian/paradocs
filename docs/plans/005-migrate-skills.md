---
title: Migrate Skills
description: Migrate Skills
date: 2026-06-18
---

# Overview

Copy all 8 SKILL.md files from Cognoscere `.agents/skills/` to paradocs `skills/`. Verify tool name references are accurate.

# Goals

- All 8 skill directories with SKILL.md exist under `skills/`
- Tool references in SKILL.md match registered tool names
- No content changes needed

# Implementation Steps

- [ ] Create `skills/knowledge/SKILL.md` — copy from `.agents/skills/knowledge/SKILL.md`
- [ ] Create `skills/create-doc/SKILL.md` — copy from `.agents/skills/create-doc/SKILL.md`
- [ ] Create `skills/web-search/SKILL.md` — copy from `.agents/skills/web-search/SKILL.md`
- [ ] Create `skills/summarize-link/SKILL.md` — copy from `.agents/skills/summarize-link/SKILL.md`
- [ ] Create `skills/brainstorm/SKILL.md` — copy from `.agents/skills/brainstorm/SKILL.md`
- [ ] Create `skills/auto-link/SKILL.md` — copy from `.agents/skills/auto-link/SKILL.md`
- [ ] Create `skills/research/SKILL.md` — copy from `.agents/skills/research/SKILL.md`
- [ ] Create `skills/roadmap/SKILL.md` — copy from `.agents/skills/roadmap/SKILL.md`

# Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Tool name mismatch | Low | Medium | Verify tool names in SKILL.md match registered tool names at runtime |
| SKILL.md references old path patterns | Low | Low | Skills reference tool names, not file paths — no path updates needed |

# UAT

1. `ls skills/` shows all 8 skill directories
2. Each directory contains a `SKILL.md` with valid frontmatter
3. Tool names mentioned in skills match registered tool names (search_para_docs, create_para_doc, web_search, etc.)

# References

- @docs/specs/004-skills-migration.md
