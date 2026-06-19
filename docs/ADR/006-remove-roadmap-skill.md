---
title: Remove Roadmap Skill
description: Remove the roadmap skill (skills/roadmap/) as it is out of scope for PARA knowledge management and its extension was already removed.
status: proposed
remaining: 1
date: 2026-06-19
---

# Context

Paradocs was extracted from Cognoscere with a focused scope: knowledge management through PARA (Projects, Areas, Resources, Archives). The migration (ADR 001) removed 3 Cognoscere components including the roadmap-scratchpad extension (5 files, ~740 lines) — documented in Spec 006. However, the roadmap skill (skills/roadmap/SKILL.md) survived the migration. This skill orchestrates learning pathway creation (clarify scope → formulate steps → search web → create docs → build milestone map) and is tightly coupled to the now-removed init_scratchpad/update_scratchpad/delete_scratchpad tools that no longer exist. The skill is orphaned: it references tools that don't exist in the migrated codebase. Keeping it would require either restoring the scratchpad infrastructure (contradicting the removal decision) or misleading the agent into attempting broken workflows.

# Decision

Delete the skills/roadmap/ directory entirely. The roadmap workflow is out of scope — Paradocs is about atomic knowledge management, not structured learning pathway planning. Users who want learning roadmaps can use a separate pi skill or the LLM's general capabilities. Cross-references in skills/AGENTS.md, README.md, and ARCHITECTURE.md will be updated to remove the roadmap skill entry. No other component depends on the roadmap skill — the knowledge, create-doc, web-search, and auto-link skills all operate independently.

# Impact

Positive: Removes orphaned code that references non-existent tools. Simplifies the project scope. Reduces maintenance surface (one fewer skill to keep in sync). Negative: Users who relied on the roadmap workflow lose it — they'll need to prompt manually. The 8→7 skill count reduction may need README/skills table updates. Low risk: the roadmap skill was a thin orchestration layer on top of other skills — no unique logic is lost.
