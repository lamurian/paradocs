---
title: Add atomicity validation to tools
description: Add atomicity validation to tools
status: {{status}}
date: 2026-06-22
---

# Overview

Create `common/atomicity.ts` with a `validateAtomicity(content, title)` function that enforces the atomicity principle (one topic, ≤4 paragraphs, ≤2 headings). Integrate into create_para_doc and batch_create_para_docs.

# Goals

- [ ] validateAtomicity() function with 3 rules: one topic, ≤4 paragraphs, ≤2 headings
- [ ] Clear error messages with actionable guidance (split or condense)
- [ ] Integration in create_para_doc before any file write
- [ ] Integration in batch_create_para_docs for each document
- [ ] Error responses that the agent can use to self-correct

# Implementation Steps

- [ ] Create `common/atomicity.ts` with:
  - `validateAtomicity(content: string, title: string): { valid: boolean; rule: string; count: number; limit: number; message: string }`
  - Rule 1 (One Topic): Use title + first paragraph to infer topic. Check if content introduces multiple distinct topics. Simple heuristic: count distinct noun phrases or if body introduces concepts absent from title.
  - Rule 2 (Paragraph Limit): Split content by blank lines. Count blocks. Max 4.
  - Rule 3 (Heading Limit): Count ## and ### headings. Max 2.
  - Error messages format: "Atomicity violation: {rule}. Found {count}, max {limit}. {guidance}"
- [ ] Integrate into `extensions/para-knowledge/tools/createDoc.ts`:
  - Call first thing in execute(), before any IO or DB operations
  - On violation: return error with message
- [ ] Integrate into `extensions/batch-create/index.ts`:
  - Call for each document before file creation
  - Each doc validated independently
  - Valid docs still created; only violating doc rejected
- [ ] Update tool descriptions to mention validation

# Risks

| Likelihood | Impact | Mitigation |
|------------|--------|------------|
| Medium | Heuristic topic check may have edge cases | Conservative: if uncertain, pass (no false rejection) |
| Low | Nested headings (####) counted incorrectly | Only count ## and ###; ####+ are subsections |
| Low | Code blocks counted as paragraphs | Each code block counts as one paragraph block |

# UAT

1. Create note with 3 paragraphs, 1 heading → should succeed
2. Create note with 7 paragraphs → should fail with paragraph count error
3. Create note with 4 headings → should fail with heading count error
4. Batch with mixed valid/invalid → valid created, invalid rejected individually


This plan implements @docs/specs/027-atomicity-validation-rules.md
