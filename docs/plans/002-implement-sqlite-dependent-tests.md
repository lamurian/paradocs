---
title: Implement SQLite-Dependent Tests
description: Implement SQLite-Dependent Tests
status: {{status}}
date: 2026-06-19
---

# Overview

Create test files for modules that depend on SQLite (`:memory:` databases via `node:sqlite`) and filesystem access. These tests require setup/teardown of temporary databases and directories.

# Goals

- SQLite operations tested with real in-memory databases
- Filesystem operations tested with temp directories
- All cleanup performed reliably even on test failure

# Implementation Steps

- [ ] Create `tests/para-knowledge/sqlite-init.test.ts` — test createDb with :memory:, initDb creates all tables
- [ ] Create `tests/para-knowledge/sqlite-indexing.test.ts` — test indexFile (insert/update), removeFile, getFileTags, recomputeStats
- [ ] Create `tests/para-knowledge/sqlite-search.test.ts` — test searchDocs: text-only, tag-filtered, tag-only, empty query, FTS5 edge cases
- [ ] Create `tests/para-knowledge/files.test.ts` — test scanParaDir, scanAllParaDirs, parseFile, slugify with temp dirs
- [ ] Create `tests/yaml-enforcer/scanner.test.ts` — test findParaMdFiles with temp dirs
- [ ] Create `tests/batch-create/search.test.ts` — test findRelated, searchDocsFts, appendLinks with :memory: SQLite + temp files
- [ ] Run `npm test` to verify all tests pass

# Risks

| Likelihood | Impact | Mitigation |
|---|---|---|
| Medium | High | `node:sqlite` is experimental — verify it works in the test runner before writing tests (already verified) |
| Low | Medium | Temp directory cleanup on test failure — use `try/finally` or `afterEach` to ensure cleanup |

# UAT

1. Run `npm test` and confirm all SQLite-dependent tests pass
2. Run `npm run test:coverage` and verify sqlite-init, sqlite-indexing, sqlite-search, files, scanner show ≥80% coverage
3. Verify no temp files remain after test run


This plan implements @docs/specs/013-*.md
