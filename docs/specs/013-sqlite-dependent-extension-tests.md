---
title: SQLite-Dependent Extension Tests
description: SQLite-Dependent Extension Tests
status: proposed
remaining: 0
date: 2026-06-19
---

# Requirements Specification

- Test all exported functions that depend on SQLite (using `:memory:` databases via `node:sqlite`).
- Each test creates a fresh in-memory database, initializes schema, runs operations, then closes.
- Modules under test:
  - `extensions/para-knowledge/sqlite-init.ts` — createDb, initDb (schema creation)
  - `extensions/para-knowledge/sqlite-indexing.ts` — indexFile, removeFile, getFileTags
  - `extensions/para-knowledge/sqlite-search.ts` — searchDocs (text-only, tag-filtered, tag-only, empty query)
  - `extensions/para-knowledge/files.ts` — scanParaDir, scanAllParaDirs, parseFile (filesystem + frontmatter parsing)
  - `extensions/batch-create/search.ts` — findRelated, searchDocsFts, appendLinks
  - `extensions/yaml-enforcer/scanner.ts` — findParaMdFiles

# Design Principles

- Use `createDb(":memory:")` from sqlite-init.ts for all SQLite tests.
- For filesystem tests: use `mkdtempSync` + `writeFileSync` in `beforeEach`, `rmSync` in `afterEach`.
- For batch-create search tests: create in-memory SQLite, index test documents, then query.
- Test edge cases: non-existent tables, empty databases, duplicate entries, special characters in paths/tags.
- Filesystem tests must clean up temporary directories on completion (even on test failure).

# References

- ADR 005: Unit Test Strategy & Coverage Gates
- `tests/env.test.ts` — existing pattern for temp directory setup/teardown
- `node:sqlite` Node.js 24+ (experimental) for in-memory databases


This spec implements @docs/ADR/005-*.md
