---
title: Research Command Structured Plan
description: /research command outputs WHY/HOW/WHAT decomposition plan for agent execution
status: proposed
remaining: 1
date: 2026-06-22
---

# Requirements Specification

- /research <topic> runs the following deterministic steps in the JS handler:
  1. Call ensureNotesDb() to verify notes.db is available
  2. Search notes.db using the topic
  3. Evaluate sufficiency: LLM determines if existing PARA docs fully cover the topic
  4. If sufficient: output answer inline with @citekey citations from existing sources. NO note created.
  5. If insufficient: decompose the topic into a structured question tree:
     - 1 WHY question (core motivation or significance)
     - 1 HOW question (mechanisms or manifestations)
     - For each of WHY and HOW: 3 supporting WHAT questions (3 each = 6 total)
  6. Output a structured research plan with the question tree and instructions:
     - Phase 1: Broad search - search web for the overall topic first to get context
     - Phase 2: Decomposed search - for each top-level question (WHY, HOW), search with tier=1 academic
     - Phase 3: For each WHAT supporting question, refine search if gaps remain
     - For each source: fetch_url -> extract key evidence -> resolve_citation
     - Synthesize findings per question, then combine into coherent atomic notes
     - Confidence scoring: High (>=2 peer-reviewed), Moderate (1 credible source), Low (speculative)
     - Hard cap: 5 search rounds total
  7. Mandate atomic note creation for each distinct finding using create_para_doc
  8. The plan includes explicit checkboxes for completion criteria

- The handler does NOT execute the research itself. It outputs the plan for the agent.
- The handler uses LLM for: sufficiency evaluation, WHY/HOW/WHAT decomposition, search strategy generation
- TUI mode required for the loader
- Model required
- Plan injected via pi.sendUserMessage()

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

