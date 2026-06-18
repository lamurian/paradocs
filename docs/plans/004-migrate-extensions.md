---
title: Migrate Extensions
description: Migrate Extensions
date: 2026-06-18
---

# Overview

Copy 7 extensions from Cognoscere `.pi/extensions/` to paradocs `extensions/`. Update all import paths referencing `_common/` → `common/` and `@types/` → `types/`. Verify each extension compiles and loads correctly.

# Goals

- All 7 extensions migrated with correct directory structures
- All import paths updated
- Each extension compiles under `npx tsc --noEmit`
- Each extension can be loaded by pi (no runtime import errors)

# Implementation Steps

- [ ] Create `extensions/para-knowledge/` directory with tools/: copy all 16 files, update `_common/` → `common/` imports
- [ ] Create `extensions/web-search/`: copy 5 files, update imports
- [ ] Create `extensions/link-summarizer/`: copy 5 files, update imports
- [ ] Create `extensions/batch-create/`: copy 3 files, update imports
- [ ] Create `extensions/expand-bullets/`: copy 4 files, update imports
- [ ] Create `extensions/yaml-enforcer/`: copy 5 files, update imports
- [ ] Create `extensions/skill-gate.ts`: copy single file, update imports
- [ ] Run `npx tsc --noEmit` — fix any type errors
- [ ] Run `node scripts/check-lines.mjs` on all migrated files

# Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| SQLite path hardcoded in para-knowledge | High | Medium | Will be updated in env cascade plan; for now keep as-is |
| File exceeds 300 lines | Low | Medium | sqlite-search.ts is 290 lines, close to limit. Verify count after copy |
| Missed import path | Medium | Medium | grep for _common and @types after migration; tsc catches unresolved |

# UAT

1. Run `npx tsc --noEmit` — zero errors
2. For each extension, verify the entry point exists (`extensions/{name}/index.ts` or `extensions/{name}.ts`)
3. Run `grep -r '_common' extensions/` — zero results
4. Run `grep -r '@types' extensions/` — zero results
5. Run `node scripts/check-lines.mjs` — all files pass

# References

- @docs/specs/003-extensions-migration.md
