---
title: Add citation validation to tools
description: Add citation validation to tools
status: completed
date: 2026-06-22
---

# Overview

Add a `validateCitations(content, db)` function that scans content for @citekey references and verifies they exist in the SQLite citations table. Integrate into create_para_doc and batch_create_para_docs after atomicity validation.

# Goals

- [x] validateCitations() function in common/citation-validation.ts
- [x] Reject unresolved @? citekeys
- [x] Clear error messages listing missing citekeys
- [x] Integration in create_para_doc and batch_create_para_docs
- [x] Batch validation rejects entire batch if any doc has violations

# Implementation Steps

- [x] Add `validateCitations(content: string, db: SqliteDb): { valid: boolean; missing: string[] }` to `common/citation-validation.ts`
  - Regex: matches @citekey patterns (both narrative and parenthetical) excluding code blocks
  - Skip internal PARA doc references (file paths, not @citekeys)
  - Query each citekey against citations table
  - Return list of missing/invalid citekeys
- [x] Integrate into `extensions/para-knowledge/tools/createDoc.ts`:
  - Call after atomicity validation, before file write
  - If violations: return error with missing citekeys list
- [x] Integrate into `extensions/batch-create/index.ts`:
  - Call for each document in batch
  - If ANY doc has violations, reject entire batch
- [x] Update tool descriptions to mention this validation

# Risks

| Likelihood | Impact | Mitigation |
|------------|--------|------------|
| Low | Regex false positive (e.g. email addresses) | Tight regex: only match @citekey where citekey is alphanumeric without dots |
| Low | Race condition: citekey created between validation and write | Sequential execution — agent resolves before creating |
| Low | @ inside code blocks matched | Exclude content within backticks and code fences |

# UAT

1. Create a note with @citekey that EXISTS → should succeed
2. Create a note with @? placeholder → should fail with clear error
3. Create a note with @nonexistentkey → should fail listing missing key
4. Batch create with one doc having bad citekey → entire batch rejected


This plan implements @docs/specs/029-citation-validation-in-tools.md
