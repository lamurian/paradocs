---
title: Setup TypeScript and ESLint
description: Setup TypeScript and ESLint
date: 2026-06-18
---

# Overview

Create tsconfig.json, eslint.config.js, and .prettierrc for the paradocs project. These configs enforce strict typing, complexity limits, and consistent formatting.

# Goals

- `tsconfig.json` with strict mode, bundler resolution, and correct include paths
- `eslint.config.js` with typescript-eslint strict, complexity ≤15, import ordering
- `.prettierrc` with semicolons, double quotes, trailing commas, 100 print width
- All three configs produce zero errors on the migrated codebase

# Implementation Steps

- [ ] Create `tsconfig.json` with strict mode, ES2022, ESNext modules, bundler resolution
- [ ] Create `eslint.config.js`:
  - [ ] Import `typescript-eslint` recommended rules
  - [ ] Add `complexity: ["error", 15]`
  - [ ] Configure import ordering (external → internal → type-only)
  - [ ] Set `ignores: ["node_modules"]`
- [ ] Create `.prettierrc` with formatting rules
- [ ] Run `npx eslint extensions/ common/` — verify zero lint errors
- [ ] Run `npx tsc --noEmit` — verify zero type errors
- [ ] Run `npx prettier --check extensions/ common/` — verify formatting

# Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| ESLint config doesn't match Cognoscere's version | Medium | Medium | Pin to same eslint and typescript-eslint versions |
| Complexity rule triggers on existing code | Low | Medium | Cognoscere already enforced this — code should pass |

# UAT

1. `npx tsc --noEmit` — zero errors
2. `npx eslint extensions/ common/` — zero warnings/errors
3. `npx prettier --check extensions/ common/` — all files formatted

# References

- @docs/specs/009-typescript-and-eslint-configuration.md
