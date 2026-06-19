---
title: Delete Roadmap Skill
description: Remove the orphaned roadmap skill and clean up cross-references.
status: {{status}}
date: 2026-06-19
---

# Overview

The roadmap skill (skills/roadmap/SKILL.md) references tools (init_scratchpad, update_scratchpad, delete_scratchpad) that no longer exist. We formally remove it and its cross-references.

# Goals

- Delete skills/roadmap/ entirely
- Remove all mentions of "roadmap" skill from docs
- Verify zero dangling references

# Implementation Steps

- [ ] Delete `skills/roadmap/` directory (rm -rf)
- [ ] Edit `skills/AGENTS.md`: remove roadmap row from table
- [ ] Edit `README.md`: remove roadmap from features table and skills table
- [ ] Edit `ARCHITECTURE.md`: remove roadmap from skills list, update count from 8 to 7
- [ ] Run `grep -r 'roadmap' --include='*.md' --include='*.ts' | grep -v node_modules | grep -v '.git/'` to verify no remaining references

# Risks

| Likelihood | Impact | Mitigation |
|---|---|---|
| Low | High | Grep for remaining references after deletion |
| Low | Low | Cross-references missed — grep catches them |

# UAT

1. Confirm `skills/roadmap/` no longer exists
2. Search for "roadmap" in all `.md` and `.ts` files — only expected false positives (e.g., unrelated "roadmap" in user content)
3. Verify `ARCHITECTURE.md` says "7 skills" not "8 skills"
4. Run `npm run test` — no test failures from missing references

# References

- Spec 016: Remove Roadmap Skill

This plan implements @docs/specs/016-*.md

