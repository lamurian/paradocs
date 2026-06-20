---
title: Reference Convention Consolidation
description: Remove remaining reference/conversational skills and bake conventions into tool descriptions
status: implemented
remaining: 0
date: 2026-06-20
---

# Context

After ADR 010, 4 skills remain: web-search (documents tier/category conventions already implemented in the tool), create-doc (citation format, atomic principle, classification rules), brainstorm (10-line instruction for clarifying questions), and auto-link (now automatic per ADR 010). The web-search skill is pure documentation of what the tool already does. The create-doc skill defines standards that should live alongside the tools that enforce them. Brainstorm is trivial — the agent naturally asks clarifying questions. Options considered: (a) keep as skills — redundant; (b) bake conventions into tool descriptions — single source of truth; (c) convert to reference docs in Resources/ — adds indirection.

# Decision

Remove all 4 skills. Bake web-search tier/category conventions into the web_search tool description field. Bake create-doc conventions (citation format, atomic principle, PARA classification, naming) into create_para_doc and batch_create_para_docs tool descriptions. Remove skills/ from package.json pi manifest. Drop brainstorm entirely — the agent already asks clarifying questions naturally.

# Impact

Removes 4 skill files. Removes the entire skills/ directory from the pi manifest. Tool descriptions become more comprehensive but conventions live alongside the tools that use them. Single source of truth for web-search and doc creation conventions. No more /skill:brainstorm but the agent's conversational ability covers this. Package.json pi section simplifies to only extensions/.
