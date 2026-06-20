---
title: Tool Description Updates
description: Tool Description Updates
status: proposed
remaining: 0
date: 2026-06-20
---

# Requirements Specification

- Update web_search tool description to include tier/category conventions currently in web-search/SKILL.md
- Update create_para_doc tool description to include citation format (Pandoc-style @citekey), atomic principle (one idea per note, ≤4 paragraphs), PARA classification rules, naming conventions
- Update batch_create_para_docs tool description similarly
- The goal: an agent reading the tool descriptions has ALL the information needed to use these tools correctly, without requiring a separate skill file
- Tool descriptions must be concise but complete — no external references needed

# Design Principles

- Tool descriptions are single-source-of-truth for how to use each tool
- No duplication — if a convention is in the tool description, it's not also in a skill file
- Web-search conventions to add to web_search description:
  - Tier 1 = scientific_publications category (academic papers)
  - Tier 2 = web category with site:edu|gov filtering (authoritative non-academic)
  - Category override for tier 2: it (tech), news, web
  - Tier 3 = general (unrestricted)
  - Fallback chain: SearXNG → Tavily → Bing RSS
- Create-doc conventions to add to create_para_doc/batch_create_para_docs descriptions:
  - Citation format: Pandoc-style @citekey, [@citekey] parenthetical
  - Atomic principle: one key idea per note, max 4 paragraphs, ≤300 lines
  - PARA classification: Resources for reference, Areas for responsibilities, Projects for deliverables
  - Naming: kebab-case slug from title
  - Recommended body structure: ## Summary, ## Key Points, ## Sources

# References

- ADR 010: @docs/ADR/010-reference-convention-consolidation.md
- web-search/SKILL.md (source conventions being migrated)
- create-doc/SKILL.md (source conventions being migrated)
- web-search extension: index.ts (tool registration with description)
- para-knowledge extension: index.ts (tool registration with description)

This spec implements @docs/ADR/010-reference-convention-consolidation.md
