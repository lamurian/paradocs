---
title: Tool-Level Atomicity Enforcement
description: Atomicity is enforced via LLM-driven Q&A decomposition at the command level, with a single-topic keyword heuristic as a tool-level safety net
status: implemented
remaining: 0
date: 2026-07-14
---

# Context

The atomicity principle requires each note to have one clear research question and one indicative answer. Previously, quantitative limits (paragraph/heading counts) were enforced at the tool level, but these caused false rejections of legitimate complex notes and did not capture the qualitative nature of atomicity. Agents need guidance on composing atomic notes, but the enforcement should be flexible enough to accommodate varying depths of treatment. Options considered: (a) quantitative limits (paragraphs, headings) — simple but causes false rejections; (b) qualitative Q&A criterion at the LLM level with a lightweight tool-level heuristic — more flexible, LLM-driven, minimal false rejections; (c) no tool-level enforcement — risks multi-topic notes entering the knowledge base.

# Decision

Shift from quantitative to qualitative atomicity enforcement. The primary atomicity gate is LLM decomposition at the command level: each note must have one research question and one indicative answer. A lightweight single-topic heuristic (keyword overlap between heading sections and the title) acts as a tool-level safety net, flagging content where 2+ headings share no keywords with the title. Paragraph limits and heading limits are removed from the tool-level validation. Tool descriptions instruct agents to compose notes using the Q&A criterion.

# Impact

Benefits: eliminates false rejections on paragraph/heading counts; more flexible for complex topics that naturally require depth; the Q&A criterion is semantically meaningful and easy for LLMs to reason about. Costs: the tool-level safety net cannot catch all multi-topic violations — it relies on the LLM to decompose correctly. Migration: legacy quantitative limits removed from tool code and descriptions; existing notes in the DB are not retroactively validated. Risk: agents may create overly long notes, but this is preferable to false rejections that break workflow.
