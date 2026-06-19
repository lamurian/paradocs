---
title: Extensions Migration
description: Migrate 7 extensions from Cognoscere .pi/extensions/ to paradocs extensions/.
date: 2026-06-18
status: implemented
---

# Requirements Specification

- Migrate 7 extensions from Cognoscere `.pi/extensions/` to paradocs `extensions/`
- Preserve all file structures (single-file extensions stay single-file, multi-file stay multi-file)
- Update all import paths referencing `_common/` → `common/` and `@types/` → `types/`
- Do NOT migrate: `set-temperature.ts`, `scope-gate.ts`, `roadmap-scratchpad/`

## File Mapping

### para-knowledge (11 files — core extension with 6 tools)
| Source | Destination |
|---|---|
| `.pi/extensions/para-knowledge/index.ts` | `extensions/para-knowledge/index.ts` |
| `.pi/extensions/para-knowledge/types.ts` | `extensions/para-knowledge/types.ts` |
| `.pi/extensions/para-knowledge/db-sqlite.ts` | `extensions/para-knowledge/db-sqlite.ts` |
| `.pi/extensions/para-knowledge/files.ts` | `extensions/para-knowledge/files.ts` |
| `.pi/extensions/para-knowledge/frontmatter.ts` | `extensions/para-knowledge/frontmatter.ts` |
| `.pi/extensions/para-knowledge/similarity.ts` | `extensions/para-knowledge/similarity.ts` |
| `.pi/extensions/para-knowledge/sqlite-init.ts` | `extensions/para-knowledge/sqlite-init.ts` |
| `.pi/extensions/para-knowledge/sqlite-indexing.ts` | `extensions/para-knowledge/sqlite-indexing.ts` |
| `.pi/extensions/para-knowledge/sqlite-search.ts` | `extensions/para-knowledge/sqlite-search.ts` |
| `.pi/extensions/para-knowledge/sqlite-types.ts` | `extensions/para-knowledge/sqlite-types.ts` |
| `.pi/extensions/para-knowledge/tools/searchDocs.ts` | `extensions/para-knowledge/tools/searchDocs.ts` |
| `.pi/extensions/para-knowledge/tools/createDoc.ts` | `extensions/para-knowledge/tools/createDoc.ts` |
| `.pi/extensions/para-knowledge/tools/updateDoc.ts` | `extensions/para-knowledge/tools/updateDoc.ts` |
| `.pi/extensions/para-knowledge/tools/listTags.ts` | `extensions/para-knowledge/tools/listTags.ts` |
| `.pi/extensions/para-knowledge/tools/findExistingSummary.ts` | `extensions/para-knowledge/tools/findExistingSummary.ts` |
| `.pi/extensions/para-knowledge/tools/resolveCitation.ts` | `extensions/para-knowledge/tools/resolveCitation.ts` |

### web-search (4 files)
| Source | Destination |
|---|---|
| `.pi/extensions/web-search/index.ts` | `extensions/web-search/index.ts` |
| `.pi/extensions/web-search/AGENTS.md` | `extensions/web-search/AGENTS.md` |
| `.pi/extensions/web-search/native.ts` | `extensions/web-search/native.ts` |
| `.pi/extensions/web-search/searxng.ts` | `extensions/web-search/searxng.ts` |
| `.pi/extensions/web-search/tavily.ts` | `extensions/web-search/tavily.ts` |

### link-summarizer (5 files)
| Source | Destination |
|---|---|
| `.pi/extensions/link-summarizer/index.ts` | `extensions/link-summarizer/index.ts` |
| `.pi/extensions/link-summarizer/cdp.ts` | `extensions/link-summarizer/cdp.ts` |
| `.pi/extensions/link-summarizer/http.ts` | `extensions/link-summarizer/http.ts` |
| `.pi/extensions/link-summarizer/pdf.ts` | `extensions/link-summarizer/pdf.ts` |
| `.pi/extensions/link-summarizer/tavily-extract.ts` | `extensions/link-summarizer/tavily-extract.ts` |

### batch-create (3 files)
| Source | Destination |
|---|---|
| `.pi/extensions/batch-create/index.ts` | `extensions/batch-create/index.ts` |
| `.pi/extensions/batch-create/search.ts` | `extensions/batch-create/search.ts` |
| `.pi/extensions/batch-create/yaml.ts` | `extensions/batch-create/yaml.ts` |

### expand-bullets (4 files)
| Source | Destination |
|---|---|
| `.pi/extensions/expand-bullets/index.ts` | `extensions/expand-bullets/index.ts` |
| `.pi/extensions/expand-bullets/parser.ts` | `extensions/expand-bullets/parser.ts` |
| `.pi/extensions/expand-bullets/search.ts` | `extensions/expand-bullets/search.ts` |
| `.pi/extensions/expand-bullets/synthesis.ts` | `extensions/expand-bullets/synthesis.ts` |

### yaml-enforcer (5 files)
| Source | Destination |
|---|---|
| `.pi/extensions/yaml-enforcer/index.ts` | `extensions/yaml-enforcer/index.ts` |
| `.pi/extensions/yaml-enforcer/analyzer.ts` | `extensions/yaml-enforcer/analyzer.ts` |
| `.pi/extensions/yaml-enforcer/scanner.ts` | `extensions/yaml-enforcer/scanner.ts` |
| `.pi/extensions/yaml-enforcer/check-tool.ts` | `extensions/yaml-enforcer/check-tool.ts` |
| `.pi/extensions/yaml-enforcer/standardize-tool.ts` | `extensions/yaml-enforcer/standardize-tool.ts` |

### skill-gate (single file)
| Source | Destination |
|---|---|
| `.pi/extensions/skill-gate.ts` | `extensions/skill-gate.ts` |

## Import Path Updates

For each file that imports from `_common/` or `@types/`, update the path:
- `../_common/slug.js` → `../common/slug.js`
- `../../_common/yaml.js` → `../../common/yaml.js`
- `../@types/citation-js.d.ts` → `../types/citation-js.d.ts`

# Design Principles

- **Copy exactly**: File contents are identical except for import path strings.
- **Preserve structure**: Multi-file extensions keep their directory layout.
- **No functional changes**: The code works identically after migration.

# References

- ADR 001: Migration Architecture
- Spec 001: Shared Modules Migration
- Spec 002: Type Stubs Migration

This spec implements @docs/ADR/001-*.md
