---
title: AI-Based Atomicity Validation
description: Atomicity is validated via AI-based Q&A evaluation at the tool level, with LLM-powered decomposition and batch auto-expansion
status: implemented
remaining: 0
date: 2026-07-14
---

# Requirements Specification

- create_para_doc and batch_create_para_docs MUST validate submitted content against the atomicity principle before creating the file
- The atomicity principle: content must have one clear research question and one clear indicative answer. The question may be stated implicitly or explicitly. The question and answer together form a single coherent topic.
- The atomicity check is performed by an LLM call (temp=0) that evaluates whether content satisfies the Q&A criterion
- On violation with suggested splits: create_para_doc returns an error listing the decomposed notes and advises using batch_create_para_docs; batch_create_para_docs auto-expands by replacing the failed doc with its suggested splits
- On violation without splits: both tools return the LLM's rejection message
- On LLM failure or cancellation: the check fails open (passes content through) to avoid blocking document creation
- The batch variant validateDocumentsAtomicity() evaluates all documents in a single LLM call for efficiency
- Auto-expansion is limited to one level: expanded notes are not re-checked for atomicity
- Documents that fail atomicity without any suggested splits are moved to validation errors
- Expansion count is reported in the output
- Auto-link step runs ONLY after successful validation and creation
- Validation runs BEFORE any file write or DB indexing

# Design Principles

- Validation must run before any IO — no partial writes
- Error messages must be actionable: tell the agent exactly what to do
- Fail-open on LLM errors: an unavailable LLM should not block document creation
- The LLM infers the correct PARA area (Resources/Areas/Projects) for each suggested split based on content nature
- The prompts are stored in atomicity-prompts.ts to keep atomicity.ts under 300 lines
- Implementation: validateAtomicity(content, title, ctx?) in common/atomicity.ts returns Promise<AtomicityResult>
- Batch variant: validateDocumentsAtomicity(docs, ctx?) returns Promise<AtomicityResult[]>
- Exported for use in both create_para_doc (createDoc.ts) and batch_create_para_docs (batch-create/index.ts)

# References

- ADR 011: @docs/ADR/011-tool-level-atomicity-enforcement.md
- common/atomicity.ts: AI-based atomicity validation
- common/atomicity-prompts.ts: LLM system prompts for atomicity evaluation
- common/llm.ts: shared LLM call utility
