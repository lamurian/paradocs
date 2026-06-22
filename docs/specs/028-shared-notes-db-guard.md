---
title: Shared Notes DB Guard
description: Shared ensureNotesDb() function that auto-provisions notes.db from PARA directories
status: proposed
remaining: 1
date: 2026-06-22
---

# Requirements Specification

- All commands and tools that need notes.db MUST call ensureNotesDb(cwd) instead of directly creating DB instances
- ensureNotesDb(cwd): (1) resolves the knowledge directory and DB filename from env config; (2) checks if the SQLite file exists at that path; (3) if missing, calls rebuildDb() to scan ALL .md files in Projects/, Areas/, and Resources/ directories (excluding any file named AGENTS.md) and index them into FTS5; (4) returns an opened SqliteDb handle
- If the DB already exists, the function simply opens and returns the handle (no index rebuild)
- The function MUST be a singleton for the process lifetime - subsequent calls return the same handle without re-checking
- Must handle the case where the knowledge directory or PARA subdirectories don't exist yet - graceful fallback with empty DB
- Must handle the case where rebuildDb is interrupted (sigterm, crash) - idempotent second call

# Design Principles

- Lazy singleton pattern: first call performs check-and-rebuild, subsequent calls return cached handle
- The function lives in common/notesDb.ts
- Calls configureEnv() internally to ensure env vars are loaded
- rebuildDb already exists in extensions/para-knowledge/rebuild.ts - this function delegates to it
- Error handling: if rebuild fails (permissions, disk full), return error rather than crashing
- Replace all direct createDb+initDb calls in: ask.ts, research.ts, ask-orchestrator.ts, createDoc.ts, batch-create/index.ts, citation.ts, autoLink.ts

# References

- ADR 012: @docs/ADR/012-notes-db-auto-provisioning.md
- extensions/para-knowledge/rebuild.ts: existing rebuildDb function
- extensions/para-knowledge/db-sqlite.ts: createDb, initDb
- common/env.ts: getKnowledgeConfig
- common/citation.ts: existing direct DB calls to replace
