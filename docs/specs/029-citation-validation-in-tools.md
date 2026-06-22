---
title: Citation Validation in Tools
description: Citation validation step in create_para_doc that rejects unresolved citekeys
status: proposed
remaining: 1
date: 2026-06-22
---

# Requirements Specification

- create_para_doc and batch_create_para_docs MUST validate that all @citekey references in submitted content exist in the SQLite citations table before creating the file
- Validation regex: match all @citekey patterns (Pandoc-style narrative @citekey and parenthetical [@citekey]) except those inside code blocks or inline code with backticks
- For each found citekey: query the citations table; if the citekey doesn't exist or the raw key is @? (unresolved placeholder), record a violation
- On violation: reject the creation with a clear error listing ALL unresolved citekeys and instructing the agent to call resolve_citation for each before retrying
- Internal PARA doc references (file paths like Projects/foo.md) are exempt - they don't use citekeys
- The validation step runs AFTER atomicity validation (ADR 011) and BEFORE file write
- batch_create_para_docs: validates ALL documents in the batch; if any document has violations, the entire batch is rejected to prevent partial creation

# Design Principles

- Validation function: validateCitations(content, db): { valid: boolean; missing: string[] }
- Export from common/citations.ts (enhance the existing module)
- The regex must not match markdown link syntax like [text](@citekey)
- The regex must handle edge cases: @citekey at end of sentence (before period), inside parentheses, after punctuation
- The agent is expected to: search web -> fetch URL -> resolve_citation -> then create note. This validation enforces that order.
- The @? pattern: agents sometimes use @? as a placeholder for unresolved citations - this MUST be rejected

# References

- ADR 013: @docs/ADR/013-mandatory-citation-resolution.md
- common/citation.ts: existing citation module (enhance with validation)
- Spec 027: @docs/specs/027-atomicity-validation-rules.md (validation order)
- common/createDocument.ts: callers of citation validation
