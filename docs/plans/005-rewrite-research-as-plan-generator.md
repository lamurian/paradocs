---
title: Rewrite /research as plan generator
description: Rewrite /research as plan generator
status: {{status}}
date: 2026-06-22
---

# Overview

Rewrite the /research command handler to decompose topics via WHY/HOW/WHAT question tree and output a structured research plan. The handler evaluates sufficiency first, then either answers from existing docs or generates a plan with two-phase search strategy.

# Goals

- [ ] /research handler outputs WHY/HOW/WHAT decomposition plan
- [ ] Sufficiency evaluation: if existing docs cover topic, answer inline (no note)
- [ ] If insufficient: structured plan with broad-search-first, then decomposed search
- [ ] WHY + HOW core questions, each with 3 WHAT supporting questions
- [ ] Two-phase search strategy: broad first, then per-question
- [ ] Plan includes confidence scoring rubric and completion criteria
- [ ] Handler under 120 lines

# Implementation Steps

- [ ] Modify `extensions/commands/research.ts`:
  - `createHandler()` → within TUI custom:
    - Call `ensureNotesDb()` (from spec 028)
    - Search PARA docs via `searchDocs()`
    - LLM call: evaluate sufficiency
    - If sufficient: `pi.sendUserMessage()` with inline answer from existing docs
    - If insufficient: LLM decomposition into:
      - `{ "why": { "question": "...", "supporting": [...3 WHAT questions...] }, "how": { "question": "...", "supporting": [...3 WHAT questions...] } }`
    - Format structured research plan with:
      - "## Research Plan: {topic}"
      - Question tree display
      - "Phase 1: Broad search — search the web for the overall topic"
      - "Phase 2: Decomposed search — search per top-level question with tier=1 academic"
      - "Phase 3: Gap fill — search per WHAT supporting question if needed"
      - Citation instructions: fetch → resolve_citation → note creation
      - Confidence scoring rubric (High >=2 peer-reviewed, Moderate 1 source, Low speculative)
      - Completion criteria checklist
      - Atomic note naming convention: Resources/research-{topic-slug}-{idea-slug}.md

# Risks

| Likelihood | Impact | Mitigation |
|------------|--------|------------|
| Low | LLM produces malformed JSON | Fallback to default decomposition with topic as both WHY and HOW |
| Low | Agent searches too narrowly | Plan explicitly states "broad search before decomposition" |
| Medium | User expects instant execution | Loader message explains decomposition phase |

# UAT

1. /research "dopamine and motivation" → verify WHY/HOW/WHAT tree, two-phase search strategy
2. /research with existing PARA doc covering topic → verify inline answer, no plan
3. /research without topic → verify warning
4. Execute a generated plan end-to-end → verify atomic notes created, citations resolved


This plan implements @docs/specs/031-research-command-structured-plan.md
