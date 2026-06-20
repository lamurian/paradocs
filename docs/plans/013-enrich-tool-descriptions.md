---
title: Enrich Tool Descriptions
description: Port web-search and create-doc conventions into tool descriptions
status: {{status}}
date: 2026-06-20
---

# Overview

Bake the web-search and create-doc conventions into the tool descriptions of web_search, create_para_doc, and batch_create_para_docs. This removes the need for separate skill files entirely.

# Goals

- web_search tool description includes tier/category/fallback conventions from the web-search skill
- create_para_doc tool description includes citation format, atomic principle, PARA classification, naming conventions, and recommended body structure
- batch_create_para_docs tool description includes the same conventions as create_para_doc
- All conventions are complete enough that an agent reading the tool description can use the tool correctly without external reference

# Implementation Steps

- [ ] Edit extensions/web-search/index.ts: expand web_search tool's description field to include tier definitions, category mappings, and fallback chain (port content from skills/web-search/SKILL.md)
- [ ] Edit extensions/para-knowledge/index.ts: expand create_para_doc tool's description to include citation format (@citekey, [@citekey]), atomic principle (one idea, ≤4 paragraphs), PARA classification guide, naming conventions (kebab-case slug), recommended body structure
- [ ] Edit extensions/batch-create/index.ts: expand batch_create_para_docs tool's description with same conventions
- [ ] Verify tool descriptions render correctly by checking pi extension load output

# Risks

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Tool description too long affects system prompt | Medium | Low | Keep descriptions concise — use bullets, not prose blocks |
| Forgetting to port a convention | Medium | Medium | Read the original skill files side-by-side while editing |

# UAT

1. Run `pi --list-extensions` and verify the updated tool descriptions appear
2. An agent reading only the tool description should be able to use each tool correctly

This plan implements @docs/specs/025-tool-description-updates.md
