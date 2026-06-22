---
title: Notes DB Auto-Provisioning
description: Before any notes.db operation, check existence and auto-populate from PARA directories if missing
status: proposed
remaining: 1
date: 2026-06-22
---

# Context

Currently, commands and tools call createDb() directly without checking if the SQLite database exists. If notes.db is missing (fresh checkout, corrupted file, first run), operations fail silently or produce confusing errors. Options considered: (a) require manual rebuild - fragile, poor UX; (b) auto-detect and rebuild on first access - seamless; (c) check on every command entry - redundant if already exists. The rebuildDb function already exists in extensions/para-knowledge/rebuild.ts but nothing calls it automatically. A shared guard function in common/ can wrap this logic, ensuring all tools and commands benefit without code duplication.

# Decision

Create a shared guard function ensureNotesDb(cwd) in a new common/notesDb.ts module. It: (1) checks if the SQLite database file (notes.db) exists at the configured path; (2) if missing, calls the existing rebuildDb() to scan PARA directories (Projects/, Areas/, Resources/) and index all .md files (excluding any AGENTS.md) into FTS5; (3) returns the opened db handle. All commands and tools that need notes.db call this function first, replacing their current ad-hoc createDb+initDb calls.

# Impact

Benefits: eliminates first-run failures; ensures consistent database state; centralises DB lifecycle logic. Costs: one additional function call on first access (negligible, ~2-3 seconds for scans of ~1000 files); rebuildDb already exists so no new complex code. Risk: if PARA directory is empty or misconfigured, guard creates an empty database rather than failing - tools must handle zero-result queries gracefully. This is acceptable - empty DB is a valid state.
