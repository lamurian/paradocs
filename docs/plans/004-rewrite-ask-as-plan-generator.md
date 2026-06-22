---
title: Rewrite /ask as plan generator
description: Rewrite /ask as plan generator
status: {{status}}
date: 2026-06-22
---

# Overview

Rewrite the /ask command handler from JS-orchestrated research loop to a structured plan generator. The handler evaluates sufficiency of existing PARA docs, then outputs either an inline answer or a structured research plan for the agent to execute.

# Goals

- [ ] /ask handler outputs structured plan instead of executing research
- [ ] Sufficiency evaluation using LLM (PARA search → enough? → answer or plan)
- [ ] If sufficient: inline answer with citations, NO note created
- [ ] If insufficient: structured plan with web search queries, citation steps, note creation instructions
- [ ] Remove old JS orchestration files (ask-orchestrator.ts, ask-helpers.ts)
- [ ] Handler under 100 lines

# Implementation Steps

- [ ] Modify `extensions/commands/ask.ts`:
  - `createHandler()` → within TUI custom:
    - Call `ensureNotesDb()` (from spec 028)
    - Search PARA docs via `searchDocs()`
    - LLM call: evaluate if existing docs are sufficient
    - If sufficient: `pi.sendUserMessage()` with inline answer citing @citekeys from existing docs
    - If insufficient: `pi.sendUserMessage()` with structured plan:
      - "## Research Plan" heading
      - "Question: {question}"
      - "**Phase 1**: Sufficiency check — will search notes.db"
      - "**Phase 2**: Web search — search for: {query 1}, {query 2}"
      - "**Phase 3**: Fetch and cite — for each result, fetch_url then resolve_citation"
      - "**Phase 4**: Synthesize — create atomic notes using create_para_doc"

- [ ] Remove `extensions/commands/ask-orchestrator.ts` — entire file deleted
- [ ] Remove `extensions/commands/ask-helpers.ts` — entire file deleted
- [ ] Update `extensions/commands/index.ts` if imports need updating

# Risks

| Likelihood | Impact | Mitigation |
|------------|--------|------------|
| Low | Agent doesn't follow the plan | Tool-level guardrails (atomicity, citation) enforce quality |
| Low | LLM plan is poor quality | Structured prompt with JSON output enforces format |
| Medium | User expects instant answer | Loader message explains: "Generating research plan..." |

# UAT

1. /ask "what is the capital of France" with existing PARA docs → verify inline answer, no note
2. /ask a complex question with no existing docs → verify plan output with search queries
3. /ask without question → verify warning message
4. /ask without TUI → verify error message


This plan implements @docs/specs/030-ask-command-structured-plan.md
