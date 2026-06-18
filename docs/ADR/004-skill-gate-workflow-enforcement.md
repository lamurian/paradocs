---
title: Skill Gate Workflow Enforcement
description: Event interceptor that enforces search-first-ask-later workflow for PARA knowledge management.
status: proposed
date: 2026-06-18
---

# Context

The pi agent needs guardrails to ensure it follows the PARA knowledge workflow: always search existing documents before creating new ones, do web research when existing knowledge is insufficient, create atomic notes that collectively answer the question, and re-search when evidence updates are demanded. Without this enforcement, the LLM may skip search, overwrite existing notes, or fail to cite sources. The skill-gate from Cognoscere provides this pattern but was designed for a broader agent workflow (including brainstorming, roadmap planning, etc.).

# Decision

Retain skill-gate.ts as an event interceptor extension. Re-scope the workflow to paradocs-specific behavior: (1) On any user question, gate requires search_para_docs to be called first in the turn. (2) If search returns no results or only partial matches, web_search must be called to find external sources. (3) The agent must create atomic notes (create_para_doc / batch_create_para_docs) that collectively answer the question. (4) When the user explicitly demands an evidence update, web_search must run again. The gate is soft — it warns via ctx.ui.notify rather than blocking. The /bypass-gate command is retained for power users.

# Impact

Agents follow a consistent, reliable workflow that prevents hallucination and duplicate notes. The soft gating (warnings instead of blocks) keeps the user in control while nudging toward best practices. The gate adds ~200 lines of code but eliminates the most common failure modes in knowledge management workflows. Power users can bypass with /bypass-gate. The downside is a small runtime overhead from event interception on each tool call.
