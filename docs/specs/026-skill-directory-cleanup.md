---
title: Skill Directory Cleanup
description: Skill Directory Cleanup
status: proposed
remaining: 0
date: 2026-06-20
---

# Requirements Specification

- Delete the following skill files:
  - skills/web-search/SKILL.md
  - skills/create-doc/SKILL.md
  - skills/brainstorm/SKILL.md
  - skills/auto-link/SKILL.md
  - skills/knowledge/SKILL.md
  - skills/research/SKILL.md
  - skills/summarize-link/SKILL.md
- Remove skills/ from package.json pi.skills entry
- Update root AGENTS.md to remove the skills/ directory from the table
- Update extensions/AGENTS.md if it references skills
- Update ARCHITECTURE.md if it references skills
- After this, the skills/ directory still exists on disk but is no longer loaded by pi
- Optionally keep empty skills/ directory for future use, or remove entirely

# Design Principles

- Package.json is the source of truth for what pi loads
- Remove the pi.skills entry — pi will not scan skills/ at all
- Do NOT delete the skills/ directory from disk initially (safe rollback)
- The skills content is preserved in archived form (the SKILL.md conventions are migrated to tool descriptions per spec 025)
- All deleted skills are either migrated to slash commands (knowledge→/ask, research→/research, summarize-link→/summarize), baked into tool descriptions (web-search, create-doc), made automatic (auto-link), or dropped entirely (brainstorm)

# References

- ADR 010: @docs/ADR/010-reference-convention-consolidation.md
- ADR 009: @docs/ADR/009-slash-command-workflows.md
- Spec 025: @docs/specs/025-tool-description-updates.md
- package.json (pi section)

This spec implements @docs/ADR/010-reference-convention-consolidation.md
