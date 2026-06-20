---
title: Markdown Link Format for PARA Cross-References
description: Replace [[slug]] wikilink syntax with standard [title](path.md) markdown links across all skills and extensions.
status: implemented
remaining: 0
date: 2026-06-19
---

# Context

The PARA knowledge system uses `[[slug]]` (wikilink) syntax for cross-references between notes. This format is non-standard Markdown — it requires tool-specific rendering to resolve links. The auto-link skill generates these wikilinks, and skills like create-doc and research use them as template placeholders. The batch-create extension already generates standard `[title](path)` markdown links via the `appendLinks` function, but the skills still reference wikilinks. Users expect standard Markdown link rendering, and the system already has a SQLite `files` table that stores each document's path and title — the data needed to resolve markdown links is already available.

# Decision

Replace all `[[slug]]` wikilink syntax with standard Markdown `[Display Title](path-from-knowledge-dir.md)` links. The path is the full relative path from the knowledge base root directory (e.g., `Resources/note-title.md`), and the display title is resolved from the SQLite `files` table by path. The `.md` extension is included in the path for direct rendering compatibility with standard Markdown renderers. This applies to all cross-reference output (auto-link generated links, template placeholders in skills, and "Relevant notes" sections) and all instruction text that references wikilinks across skills and extensions.

# Impact

Positive: Standard Markdown compatibility means links render correctly in any Markdown viewer without tool-specific parsing. The `files` table already has path and title fields, so no database migration is needed. Users see human-readable link text (the note title) instead of opaque slugs. Negative: Paths are longer than bare slugs and require knowledge area prefix. Links will break if a note is moved to a different area. The auto-link skill's instructions for slug extraction become irrelevant and need rewriting.
