---
title: Structured Plan-Based Command Workflows
description: Hybrid architecture — commands use JS note creation for sufficiency path, structured plans for insufficient path
status: accepted
remaining: 0
date: 2026-06-23
---

# Context

Current architecture: /ask is JS-orchestrated with document creation while /research outputs structured plans for the agent. The plan-only approach produced shallow output because the agent struggled to decompose broad syntheses into atomic notes. Users expected in-depth, multi-note research output but got single condensed notes after hitting atomicity guardrails. Options considered: (a) plan-only — outputs plans, agent executes all creation — fragile when agent struggles with decomposition; (b) hybrid — JS handler creates notes via createDocument() when the LLM returns a novel synthesis, outputs plans when web research is needed — more deterministic for the common path; (c) full JS orchestration — most deterministic but high complexity.

# Decision

Adopt a hybrid architecture:
- Both /ask and /research retain the sufficiency check + inline answer, enriched with proper note creation
- /research uses JS note creation (via createDocument) for the sufficiency path when the LLM returns a novel synthesis with a notes[] array of atomic chunks — each chunk becomes a separate atomic note
- /research outputs a structured research plan when the LLM determines existing knowledge is insufficient and web research is needed
- /ask preserves its existing JS document creation pattern (createNote handling)
- The research plan output is reserved for cases where new web research is needed

This replaces the earlier plan-only decision. The hybrid approach gives better results because the LLM decomposes syntheses into atomic notes within the TUI loader context, where it has access to the full conversation context and can reason about proper decomposition.

# Impact

Benefits: more deterministic note creation for the common path (sufficiency + novel synthesis); LLM handles decomposition within the TUI context where it has full context; multi-note notes[] output creates several atomic documents from one synthesis; tool-level mechanical checks (headings, paragraphs) act as safety net for the LLM's semantic decomposition. Costs: more JS code in handlers (~140 lines vs ~50-80 for plan-only); handlers need createDocument import and area/description logic. Risk: low — pattern is already proven in /ask since it was already JS-orchestrated.
