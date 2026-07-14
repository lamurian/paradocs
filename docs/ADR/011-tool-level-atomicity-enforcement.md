---
title: AI-Based Atomicity Enforcement
description: Atomicity is enforced via AI-based Q&A evaluation at the tool level, with LLM-powered decomposition and auto-expansion in batch mode
status: implemented
remaining: 0
date: 2026-07-14
---

# Context

The atomicity principle requires each note to have one clear research question and one indicative answer. Previously, a keyword-overlap heuristic (validateSingleTopic) was used as a tool-level safety net, but it was unreliable: it only flagged cases where 2+ headings shared no keywords with the title, and passed blatantly multi-topic content that had fewer than 2 headings. The heuristic could not assess whether content truly served one Q&A pair. Agents needed guidance on decomposing multi-topic content into atomic notes, but the heuristic only returned a generic rejection message. Options considered: (a) keyword-overlap heuristic — simple but unreliable, frequent false passes; (b) AI-based evaluation at the tool level — more accurate, can decompose content into suggested splits, but requires LLM access from tools; (c) no tool-level enforcement — risks multi-topic notes entering the knowledge base.

# Decision

Replace the keyword-overlap heuristic with AI-based Q&A evaluation at the tool level. The new validateAtomicity() calls an LLM with temp=0 to evaluate whether content serves exactly one question (implicit or explicit) and one answer. On failure, the LLM decomposes the content into distinct Q&A pairs, each proposed as a separate atomic note with an inferred PARA area (Resources/Areas/Projects). The single-doc tool (create_para_doc) surfaces the suggested splits and tells the agent to use batch_create_para_docs instead. The batch tool (batch_create_para_docs) auto-expands: a doc that fails atomicity with splits is transparently replaced by its decomposed notes. A batch variant validateDocumentsAtomicity() evaluates all docs in one LLM call for efficiency. On LLM failure or cancellation, the check fails open (passes content through) to avoid blocking document creation when the LLM is unavailable.

# Impact

Benefits: accurate Q&A-based evaluation replaces unreliable keyword matching; LLM can decompose complex content into proper atomic notes; batch mode auto-expansion streamlines the workflow; fail-open prevents LLM outages from blocking document creation; prompt splitting into atomicity-prompts.ts keeps modules under 300 lines. Costs: each create_para_doc call now makes an LLM call (~1-3s latency); batch mode mitigates this by evaluating all docs at once. Migration: old heuristic code removed entirely; existing notes in the DB are not retroactively validated. Risk: LLM may occasionally misclassify content, but fail-open minimizes impact; temp=0 with strict schema ensures high consistency.
