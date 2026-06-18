---
title: Shared Modules Migration
description: Rename _common/ to common/ with exact file mapping and import path updates.
date: 2026-06-18
---

# Requirements Specification

- Migrate 3 shared modules from Cognoscere's `_common/` to paradocs `common/`
- Rename directory only — no content changes in the source files
- Update all import paths across extensions that reference `_common/` to `common/`
- Preserve `.js` extension in relative imports (jiti convention)

## File Mapping

| Source (Cognoscere) | Destination (paradocs) | Exports | Used By |
|---|---|---|---|
| `.pi/extensions/_common/slug.ts` | `common/slug.ts` | `slugify(title: string): string` | para-knowledge, batch-create |
| `.pi/extensions/_common/tokenize.ts` | `common/tokenize.ts` | `tokenize(text: string)`, `bm25TermScore()` | para-knowledge (BM25 search) |
| `.pi/extensions/_common/yaml.ts` | `common/yaml.ts` | `formatFrontmatter()`, `yamlQuote()` | para-knowledge, batch-create, yaml-enforcer |

## Import Updates

All files importing from `_common/` must be updated:
- `import { slugify } from "../_common/slug.js"` → `import { slugify } from "../common/slug.js"`
- Same pattern for `_common/tokenize.js` and `_common/yaml.js`

# Design Principles

- **Copy exactly**: File contents are migrated byte-for-byte. No refactoring.
- **Import-only changes**: The only modifications are import path strings.
- **One source of truth**: These modules are consumed by multiple extensions; shared location avoids duplication.

# References

- ADR 001: Migration Architecture

This spec implements @docs/ADR/001-*.md
