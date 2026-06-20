---
title: Auto-Link Skill Output Migration
description: Migrate auto-link skill to output [title](path.md) markdown links instead of [[slug]] wikilinks while preserving its LLM-based semantic matching logic.
status: implemented
remaining: 0
date: 2026-06-19
---

# Context

The auto-link skill is the single source of truth for cross-reference generation in the PARA knowledge system. It currently outputs `[[slug]]` wikilinks where slug equals the filename stem (e.g., `[[measuring-semantic-similarity-of-contexts]]`). Per ADR 001, the system is moving to `[title](path.md)` format. The auto-link skill must be updated to produce the new format. The underlying semantic matching logic (searching via search_para_docs, LLM evaluation of candidates) is sound and should remain unchanged. Only the output format and related instructions need updating. Other skills (create-doc, knowledge, research, summarize-link) reference the auto-link skill's output format in their own instructions and templates — these must also be updated.

# Decision

Keep the existing 7-step auto-link workflow (read note → extract concepts → search candidates → LLM evaluate → select top candidates → append links → confirm) exactly as-is, but change the output format in steps 6 and 7 from `[[slug]]` to `[title](path)` markdown links. In step 3, change the exclusion logic from filtering by slug to filtering by full path. In step 6, the "Relevant notes" section uses `- [Title](Resources/note-title.md)` format. In step 7, the confirmation message uses `- [Title](path)` with the reason. Title is resolved from the SQLite `files` table by path. Also update all downstream skills (create-doc, knowledge, research, summarize-link) to reference the new format in their instructions and templates.

# Impact

Positive: Consistent markdown link format throughout the system. The LLM logic — the core value of the skill — remains unchanged. The batch-create extension's `appendLinks` already produces the correct format, so there's no mismatch between auto-link and batch-create workflows. Negative: Requires updating 5 skill files and 1 extension file. The "Important" note about `[[slug]]` format must be completely rewritten.
