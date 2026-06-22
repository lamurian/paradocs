---
title: Tool-Level Atomicity Enforcement
description: create_para_doc and batch_create_para_docs validate atomicity at the tool level, rejecting content that exceeds limits
status: implemented
remaining: 0
date: 2026-06-22
---

# Context

The atomicity principle (one topic per note, ≤4 paragraphs, ≤2 headings) is currently documented in tool descriptions but not enforced. Agents can create notes with multiple topics, excessive paragraphs, or more than 2 heading sections without any guardrail. This leads to knowledge base bloat, semantic duplication, and reduced search precision. Options considered: (a) document-only guidance — fragile, no enforcement; (b) tool-level validation with rejection — deterministic guardrail; (c) post-creation warnings — too late, note already created. Manual review of existing notes shows ~30% violate the 4-paragraph limit and ~15% cover multiple topics.

# Decision

Enforce atomicity at the tool level in both create_para_doc and batch_create_para_docs. Validate content against three rules before writing: (1) exactly one coherent topic inferred from title and body, (2) maximum 4 paragraphs (separated by blank lines), (3) maximum 2 heading sections (## H2 or ### H3). On violation, return a clear error message specifying which rule was broken and guidance on how to fix (split into multiple notes or condense). The auto-link step only runs after successful creation. This replaces the current 'documentation-only' approach with a hard deterministic guardrail.

# Impact

Benefits: eliminates multi-topic notes from the knowledge base; forces agents to properly structure knowledge; improves BM25 search precision. Costs: tool may reject legitimate complex notes — agent must learn the constraint and split accordingly; existing notes in the DB are not retroactively validated (only new creations). Migration: clear error messages reference the atomicity rules so agents can self-correct. Risk: agent may try to circumvent by merging paragraphs with line breaks — the paragraph check counts blank-line-separated blocks, not visual lines.
