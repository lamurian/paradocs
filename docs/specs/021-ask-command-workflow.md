---
title: Ask Command Workflow
description: Deterministic JS-orchestrated knowledge Q&A with mandatory note creation
status: implemented
remaining: 0
date: 2026-06-21
---

# Requirements Specification

- /ask <question> runs a JS-orchestrated research loop: keyword generation → PARA search → evaluation → (optional) web search → synthesis → mandatory atomic note creation
- Steps in the handler (JavaScript, not agent-prompted):
  1. Require TUI mode and a selected model
  2. Enter `ctx.ui.custom()` with a `BorderedLoader`
  3. `complete()` generates 3-5 search queries from the question
  4. `searchDocs()` in JS queries the PARA knowledge base with each keyword
  5. `complete()` evaluates results: sufficient or web search needed?
  6. If web search needed (max 3 rounds):
     - `complete()` generates specific web queries
     - `searchWeb()` in JS runs the 3-phase search engine
     - `fetchUrlAsText()` in JS fetches content from top results
     - `resolveCitation()` in JS deduplicates and creates BibTeX entries
     - `complete()` checks if enough information gathered
  7. `complete()` synthesizes the final answer with @citekey citations
  8. `createDocument()` in JS always creates an atomic note — no user confirmation
  9. `sendUserMessage()` presents the answer and document path

# Design Principles

- All tool operations run in JavaScript — deterministic, not agent-dependent
- LLM is only used for text generation: keyword generation, evaluation, synthesis
- Atomic note creation is mandatory — there is no "ask the user" step
- Citation resolution is mandatory — every web source gets a `resolve_citation` call
- Three rounds max for web search, with early exit when enough info gathered
- The handler uses `ctx.ui.custom()` which blocks the TUI during orchestration
- Results rendered to conversation via `pi.sendUserMessage()` with document reference
- Guards: requires TUI mode (`ctx.ui.custom`), requires selected model (`ctx.model`)

# References

- ADR 009: @docs/ADR/009-slash-command-workflows.md
- `extensions/commands/ask.ts` — handler and orchestrator
- `extensions/commands/ask-helpers.ts` — LLM interaction helpers
- `common/citation.ts` — shared `resolveCitation`
- `common/webSearch.ts` — shared `searchWeb`
- `common/fetchUrl.ts` — shared `fetchUrlAsText`
- `common/createDocument.ts` — shared `createDocument`
- `extensions/para-knowledge/db-sqlite.ts` — `searchDocs`

This spec implements @docs/ADR/009-slash-command-workflows.md
