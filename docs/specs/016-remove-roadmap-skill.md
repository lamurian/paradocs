---
title: Remove Roadmap Skill
description: Delete skills/roadmap/ and update all cross-references.
status: proposed
remaining: 1
date: 2026-06-19
---

# Requirements Specification

## Functional Requirements

- Delete `skills/roadmap/` directory entirely (contains SKILL.md only)
- Remove roadmap skill entry from `skills/AGENTS.md` table
- Remove roadmap skill entry from `README.md` skills table
- Remove roadmap skill entry from `ARCHITECTURE.md` skills list and overview
- Verify no other file references the roadmap skill

## Non-Functional Requirements

- Zero impact on other skills — roadmap has no dependents
- Zero dangling references after cleanup
- ARCHITECTURE.md skill count updates from 8 to 7

# Design Principles

- **Atomic removal**: delete the skill directory and all its references in one operation
- **Verify no breakage**: check that no other skill imports or references `roadmap` by name
- **Clean cross-references**: update every document that lists or describes the roadmap skill

# References

- ADR 006: Remove Roadmap Skill

This spec implements @docs/ADR/006-*.md

