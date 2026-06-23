---
title: Atomicity Validation Rules
description: Validation rules for atomicity in create_para_doc and batch_create_para_docs
status: implemented
remaining: 0
date: 2026-06-22
---

# Requirements Specification

- create_para_doc and batch_create_para_docs MUST validate submitted content against three atomicity rules before creating the file
- Rule 1 (One Topic): content must address exactly one coherent topic, inferred from title and body. Multiple distinct topics are a violation. The primary semantic atomicity gate is LLM decomposition at the command level — tool-level checks are a safety net.
- Rule 2 (Paragraph Limit): maximum 6 paragraphs for standard notes, 10 for in-depth focused notes (deep=true). Counted as blocks separated by one or more blank lines. Each code block, list, or blockquote counts as one paragraph.
- Rule 3 (Heading Limit): maximum 3 heading sections (## H2 or ### H3) for standard notes, 4 for in-depth (deep=true). A heading section includes the heading line and all content until the next heading of the same or higher level.
- The single-topic heuristic flags content when 2+ headings have no keyword overlap with the title (UNRELATED_SECTION_THRESHOLD = 2).
- On violation: return a clear error message specifying which rule was broken, the count that exceeded the limit, and guidance to split into multiple notes or condense
- Auto-link step runs ONLY after successful validation and creation
- Validation runs BEFORE any file write or DB indexing

# Design Principles

- Validation must run before any IO - no partial writes
- Error messages must be actionable: tell the agent exactly what to do
- Paragraph count: text blocks separated by blank lines. A block can contain multiple sentences/lines.
- Heading count: count ## and ### headings only. #### and below are subsections within a heading section.
- The slug and frontmatter generation runs AFTER validation passes
- Implementation: add a validateAtomicity(content) function in common/atomicity.ts
- Export the function for use in both create_para_doc (createDoc.ts) and batch_create_para_docs (batch-create/index.ts)

# References

- ADR 011: @docs/ADR/011-tool-level-atomicity-enforcement.md
- Spec 021: @docs/specs/021-ask-command-workflow.md (existing note conventions)
- common/createDocument.ts: existing doc creation pipeline
