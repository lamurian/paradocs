---
title: Research Command Structured Plan
description: /research command outputs WHY/HOW/WHAT decomposition plan for agent execution
status: implemented
remaining: 0
date: 2026-06-23
---

# Requirements Specification

- /research <topic> runs the following deterministic steps in the JS handler:
  1. Call ensureNotesDb() to verify notes.db is available
  2. Search notes.db using the topic
  3. Evaluate sufficiency: LLM uses strict prompt (RESEARCH_SUFFICIENCY_PROMPT) — sufficient=true ONLY if existing docs exhaustively cover ALL major facets
  4. If sufficient + createNote + notes[]: create multiple atomic documents via createDocument() — one per notes[] entry
  5. If sufficient + createNote + noteContent (legacy): create single atomic document via createDocument()
  6. If sufficient + no createNote: output answer inline with @citekey citations. NO note created.
  7. If insufficient: decompose the topic into a structured question tree:
     - 1 WHY question (core motivation or significance)
     - 1 HOW question (mechanisms or manifestations)
     - For each of WHY and HOW: 3 supporting WHAT questions (3 each = 6 total)
  8. Output a structured research plan with the question tree and instructions:
     - Phase 1: Broad search - search web for the overall topic first to get context
     - Phase 2: Decomposed search - for each top-level question (WHY, HOW), search with tier=1 academic
     - Phase 3: For each WHAT supporting question, refine search if gaps remain
     - For each source: fetch_url -> extract key evidence -> resolve_citation -> batch_create_para_docs
     - Synthesize findings per question, then combine into coherent atomic notes
     - Confidence scoring: High (>=2 peer-reviewed), Moderate (1 credible source), Low (speculative)
     - Hard cap: 5 search rounds total
     - If a finding exceeds 6 paragraphs or 3 headings, split into multiple atomic notes
  9. Use batch_create_para_docs for creating related notes (auto-links across the batch)

- The handler uses JS document creation (createDocument) for the sufficiency path's novel synthesis
- The handler outputs a structured plan only when web research is needed
- TUI mode required for the loader
- Model required
- Multi-note output (notes[]) is preferred over single-note (noteContent) for broad syntheses

# Design Principles

- The question tree must be structured as JSON for the agent to parse and reference
- Phase 1 (broad search) comes before decomposition to avoid narrow searching
- The handler outputs the tree AND the execution instructions as a single formatted message
- Confidence scoring from the existing research skill rubric, embedded in the plan
- The plan includes the expected naming convention for atomic notes: Resources/research-{topic-slug}-{idea-slug}.md
- The plan also includes an executive summary note that links to all atomic notes
- Handler should be ~100-120 lines max

# References

- ADR 014: @docs/ADR/014-structured-plan-based-command-workflows.md
- Spec 028: @docs/specs/028-shared-notes-db-guard.md (DB provisioning)
- Spec 027: @docs/specs/027-atomicity-validation-rules.md (tool guardrails)
- Spec 029: @docs/specs/029-citation-validation-in-tools.md (citation guardrails)
- extensions/commands/research.ts: handler to modify
- docs/specs/022-research-command-workflow.md: existing spec being superseded

