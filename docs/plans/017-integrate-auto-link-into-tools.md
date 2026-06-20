---
title: Integrate Auto-link Into Tools
description: Make auto-link run automatically in create_para_doc and batch_create_para_docs
status: {{status}}
date: 2026-06-20
---

# Overview

Make auto-link run automatically after document creation. Instead of a separate command or skill, the auto-link logic runs inside create_para_doc and batch_create_para_docs tool implementations (extracted to a shared function in common/).

# Goals

- create_para_doc runs auto-link after creating a doc
- batch_create_para_docs runs auto-link after creating all docs
- Auto-link logic extracted to a shared function for reuse
- The function takes (newDocPath: string, db: SqliteDb) and appends relevant links
- Uses existing semantic matching: extract concepts → search_para_docs → LLM evaluate → append links

# Implementation Steps

- [ ] Extract auto-link logic from auto-link/SKILL.md into a shared function in common/autoLink.ts
  - Function signature: autoLink(newDocPath: string, db: SqliteDb): Promise<void>
  - Steps: read doc → extract 3-5 key concepts → search_para_docs per concept → aggregate results → LLM evaluate (via complete()) → select top 3-7 → append ## Relevant notes via update_para_doc
  - Note: LLM evaluation step requires a model — the function needs model access
  - Alternative: skip LLM eval, use BM25 scores directly from search_para_docs (simpler, no model dependency)
  - Decision TBD: Use BM25-only (simpler) or LLM eval (more accurate but needs model)
- [ ] Integrate into extensions/para-knowledge/core.ts or similar: after create_para_doc succeeds, call autoLink()
- [ ] Integrate into extensions/batch-create/index.ts: after batch_create_para_docs succeeds, call autoLink() for each doc

# Risks

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| LLM eval requires model access in tool context | High | Medium | Use BM25-only approach — simpler, no model dependency, still effective |
| Auto-link slows down doc creation | Medium | Low | Run synchronously but keep fast (BM25 is millisecond-speed) |
| Circular linking (A links to B which links to A) | Low | Low | Auto-link never modifies other docs — only appends to the new one |

# UAT

1. Create a doc via /ask or directly — check that ## Relevant notes section appears with links
2. Create multiple docs via batch_create_para_docs — check each has relevant links

This plan implements @docs/specs/024-auto-link-integration.md
