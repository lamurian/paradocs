---
title: Ask Command Structured Plan
description: /ask command outputs structured text plan for agent execution
status: proposed
remaining: 1
date: 2026-06-22
---

# Requirements Specification

- /ask <question> runs the following deterministic steps in the JS handler:
  1. Call ensureNotesDb() to verify notes.db is available
  2. Search notes.db using the raw question
  3. Evaluate sufficiency: LLM determines if existing PARA docs fully answer the question
  4. If sufficient: output answer inline with @citekey citations from existing sources. NO note created. Purpose: prevent semantic duplication and mosaic plagiarism.
  5. If insufficient: output a structured text plan with:
     - Specific web search queries (2-3)
     - Instructions to fetch each URL and extract key info
     - Instructions to create citekeys via resolve_citation for each source
     - Instructions to create atomic notes using create_para_doc
     - Mandate that every web source MUST be resolved via resolve_citation before being referenced
     - Remind that create_para_doc enforces atomicity and citation validation

- The handler does NOT execute the research itself. It outputs the plan for the agent.
- The handler uses LLM for sufficiency evaluation and plan generation
- TUI mode required (ctx.ui.custom) for the loader
- Model required (ctx.model)
- The plan output is injected via pi.sendUserMessage() so the agent receives it as a conversation message

# Design Principles

- The handler is a plan generator, NOT an orchestrator
- LLM is used for: sufficiency evaluation, query generation, web search plan structure
- Tool-level guardrails (atomicity, citation validation) enforce quality during agent execution
- The plan includes explicit verification that the agent used all required tools
- Failure modes: if LLM decomposition fails (JSON parse error), fall back to a default plan with the original question as the search query
- The handler should be ~80-100 lines max; complexity lives in the plan prompts

# References

- ADR 014: @docs/ADR/014-structured-plan-based-command-workflows.md
- Spec 027: @docs/specs/027-atomicity-validation-rules.md (tool guardrails)
- Spec 028: @docs/specs/028-shared-notes-db-guard.md (DB provisioning)
- Spec 029: @docs/specs/029-citation-validation-in-tools.md (citation guardrails)
- extensions/commands/ask.ts: handler to modify
- extensions/commands/ask-helpers.ts: to remove (used by old JS-orchestrated /ask)
- extensions/commands/ask-orchestrator.ts: to remove

