---
title: Atomicity Validation Rules
description: Atomicity is validated qualitatively — one research question + one indicative answer per note; single-topic heuristic as safety net
status: implemented
remaining: 0
date: 2026-07-14
---

# Requirements Specification

- create_para_doc and batch_create_para_docs MUST validate submitted content against the atomicity principle before creating the file
- The atomicity principle: content must have one clear research question and one clear indicative answer. The question may be stated implicitly or explicitly. The question and answer together form a single coherent topic.
- The primary atomicity gate is LLM decomposition at the command level — the LLM is responsible for ensuring each note satisfies the Q&A criterion
- The tool-level single-topic heuristic (keyword overlap between headings and title) acts as a secondary safety net, flagging content where 2+ heading sections share no keywords with the title (UNRELATED_SECTION_THRESHOLD = 2)
- On violation: return a clear error message specifying the single-topic rule was broken and guidance to split into separate notes, one per topic
- Auto-link step runs ONLY after successful validation and creation
- Validation runs BEFORE any file write or DB indexing

# Design Principles

- Validation must run before any IO — no partial writes
- Error messages must be actionable: tell the agent exactly what to do
- Paragraph counts and heading counts are not enforced at the tool level — they are managed by the LLM during note composition
- The single-topic heuristic is conservative (no false rejections): titles with no significant words pass; content with fewer than 2 headings passes
- The slug and frontmatter generation runs AFTER validation passes
- Implementation: validateAtomicity(content, title) function in common/atomicity.ts returns AtomicityResult
- Export the function for use in both create_para_doc (createDoc.ts) and batch_create_para_docs (batch-create/index.ts)

# References

- ADR 011: @docs/ADR/011-tool-level-atomicity-enforcement.md
- common/atomicity.ts: tool-level single-topic heuristic
