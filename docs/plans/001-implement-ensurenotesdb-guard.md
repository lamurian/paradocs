---
title: Implement ensureNotesDb guard
description: Implement ensureNotesDb guard
status: {{status}}
date: 2026-06-22
---

# Overview

Create a shared `ensureNotesDb(cwd)` function in `common/notesDb.ts` that auto-provisions notes.db from PARA directories if missing. This replaces ad-hoc createDb+initDb in all consumers.

# Goals

- [ ] Shared ensureNotesDb() function with lazy singleton pattern
- [ ] Auto-provisions DB from PARA .md files if missing (excludes AGENTS.md)
- [ ] Graceful empty-DB fallback if PARA dirs don't exist
- [ ] All existing createDb+initDb call sites migrated to use ensureNotesDb

# Implementation Steps

- [ ] Create `common/notesDb.ts` with:
  - `ensureNotesDb(cwd?: string, options?: { signal?: AbortSignal }): SqliteDb`
  - Lazy singleton: first call does check+rebuild, subsequent returns cached handle
  - Calls `configureEnv(cwd)` internally
  - Checks if DB file exists at path from `getKnowledgeConfig()`
  - If missing: calls `rebuildDb()` from `extensions/para-knowledge/rebuild.ts`
  - Returns opened `SqliteDb` handle
- [ ] Add graceful error handling: if rebuild fails, return empty DB handle
- [ ] Migrate call sites:
  - `extensions/commands/ask-orchestrator.ts` → replace createDb/initDb with ensureNotesDb
  - `extensions/commands/research.ts` → add ensureNotesDb call
  - `extensions/para-knowledge/tools/createDoc.ts` → use ensureNotesDb
  - `extensions/batch-create/index.ts` → use ensureNotesDb
  - `common/citation.ts` → use ensureNotesDb
  - `common/createDocument.ts` → use ensureNotesDb
- [ ] Update `common/autoLink.ts` to use ensureNotesDb if it directly creates DB

# Risks

| Likelihood | Impact | Mitigation |
|------------|--------|------------|
| Medium | Rebuild takes >5s for large KB | Add progress callback; async rebuild that doesn't block |
| Low | Concurrent access races | Singleton + rebuildDb already has TX safety |
| Low | Empty PARA dirs cause empty DB | Handle gracefully — tools must handle zero results |

# UAT

1. Delete notes.db → run /ask → verify DB is rebuilt, search works
2. Run /ask with existing DB → verify no redundant rebuild
3. Run create_para_doc → verify DB is used correctly


This plan implements @docs/specs/028-shared-notes-db-guard.md
