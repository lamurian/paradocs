---
title: Migrate Shared Modules
description: Migrate Shared Modules
date: 2026-06-18
---

# Overview

Copy slug.ts, tokenize.ts, and yaml.ts from Cognoscere's `_common/` to paradocs `common/`. Straight rename — no content changes except import paths.

# Goals

- All 3 shared modules copied to `common/`
- All import paths in extensions updated from `_common/` to `common/`
- TypeScript compiles cleanly after the rename

# Implementation Steps

- [ ] Copy `_common/slug.ts` → `common/slug.ts`
- [ ] Copy `_common/tokenize.ts` → `common/tokenize.ts`
- [ ] Copy `_common/yaml.ts` → `common/yaml.ts`
- [ ] Search all extension files for `_common/` import paths and update to `common/`
- [ ] Run `npx tsc --noEmit` to verify clean compilation

# Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Missed import path | Low | Medium | grep for _common after migration; tsc catches unresolved imports |
| File exceeds 300 lines | Low | Low | tokenize.ts is 143 lines, yaml.ts is 85 lines, slug.ts is 11 lines — all well under limit |

# UAT

1. Verify `common/slug.ts`, `common/tokenize.ts`, `common/yaml.ts` exist
2. Run `npx tsc --noEmit` — must pass with zero errors
3. Run `grep -r '_common' extensions/` — must return zero results
4. Run `grep -r 'from.*common/' extensions/` — must show all updated imports

# References

- @docs/specs/001-shared-modules-migration.md
