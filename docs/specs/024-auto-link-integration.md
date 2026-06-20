---
title: Auto-link Integration
description: Auto-link Integration
status: proposed
remaining: 1
date: 2026-06-20
---

# Requirements Specification

- Auto-link runs automatically after any document creation (create_para_doc or batch_create_para_docs)
- No separate slash command or manual step needed
- Integration point: the create_para_doc and batch_create_para_docs tools append relevant links after creating the doc(s)
- Steps: (1) extract 3-5 key concepts from the new note's title and body, (2) search_para_docs for each concept, (3) aggregate unique results (excluding the new note), (4) LLM evaluates semantic relatedness (strong/moderate/weak), (5) select top 3-7 strong connections, (6) append ## Relevant notes section with [title](path) links via update_para_doc
- This happens inside the tool execution, not in the command handler

# Design Principles

- Auto-link is a tool-level behavior, not command-level — runs for any doc creation, not just slash commands
- Implementation: add auto-link logic to the create_para_doc and batch_create_para_docs tool execute functions
- The auto-link logic can be extracted to a shared function in common/ for reuse
- LLM-powered evaluation uses the model for semantic comparison, not BM25 alone
- Keep the existing search_para_docs (BM25) as the candidate retrieval step
- Only LLM eval step 4 uses the model — this could be a separate tool if needed

# References

- ADR 009: @docs/ADR/009-slash-command-workflows.md
- auto-link/SKILL.md (source workflow being replaced)
- para-knowledge extension: create_para_doc, batch_create_para_docs, update_para_doc, search_para_docs
- ADR 008: @docs/ADR/008-auto-link-skill-output-migration.md

This spec implements @docs/ADR/009-slash-command-workflows.md
