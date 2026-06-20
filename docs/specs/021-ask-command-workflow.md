---
title: Ask Command Workflow
description: Ask Command Workflow
status: implemented
remaining: 0
date: 2026-06-20
---

# Requirements Specification

- /ask <question> searches PARA docs first, falls back to web search if no results
- Steps: (1) search_para_docs with the question as query, (2) if results found, return summary with citations and [title](path) links, (3) if no results, run brainstrom-like clarification (ask user 2-3 clarifying questions), (4) then web_search tier=2 (or tier=1 for academic), (5) fetch_url top results, (6) synthesize answer, (7) optionally create_para_doc with the answer (ask user for confirmation)
- After doc creation, auto-link runs automatically (see auto-link integration spec)
- Always cite sources: use Pandoc-style @citekey for web sources, [title](path) for existing PARA docs
- If user didn't ask a question (just conversational), decline gracefully and suggest the conversation path

# Design Principles

- Workflow is sequential and deterministic — no branching within the handler
- Each tool call is awaited before proceeding
- Use ctx.ui.confirm() for user decisions (e.g., "Shall I save this as a new document?")
- Use ctx.ui.input() for clarification prompts if the question is vague
- Results rendered as plain text output to the conversation
- Handle timeout/errors gracefully — log via ctx.ui.notify and return partial results

# References

- ADR 009: @docs/ADR/009-slash-command-workflows.md
- knowledge/SKILL.md (source workflow being replaced)
- para-knowledge extension: search_para_docs, create_para_doc tools
- web-search extension: web_search tool
- create-doc conventions (now in tool descriptions)

This spec implements @docs/ADR/009-slash-command-workflows.md
