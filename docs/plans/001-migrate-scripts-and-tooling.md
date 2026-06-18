---
title: Migrate Scripts and Tooling
description: Migrate Scripts and Tooling
date: 2026-06-18
---

# Overview

Copy check-lines.mjs from Cognoscere, create project root package.json with paradocs identity, set up tsconfig, vitest, and eslint configs.

# Goals

- `package.json` with `name: "paradocs"`, all deps from Cognoscere plus `dotenv`
- `tsconfig.json`, `eslint.config.js`, `vitest.config.ts` matching Cognoscere with updated paths
- `scripts/check-lines.mjs` migrated
- `npm install` completes without errors

# Implementation Steps

- [ ] Copy `scripts/check-lines.mjs` from Cognoscere
- [ ] Create `package.json` with name `paradocs`, inherit all deps from Cognoscere, add `dotenv`
- [ ] Create `tsconfig.json` with `include` paths: `extensions/`, `common/`, `types/`, `tests/`, `scripts/`
- [ ] Create `eslint.config.js` with typescript-eslint strict, complexity rule, import ordering
- [ ] Create `vitest.config.ts` with coverage thresholds (70/60/70/70)
- [ ] Run `npm install` and verify all dependencies resolve
- [ ] Run `npm run check:lines` to verify the script works

# Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Dependency version mismatch | Medium | Medium | Pin to Cognoscere's proven versions |
| npm install fails | Low | High | Check Node version; pi packages use modern Node |

# UAT

1. `npm install` completes without errors
2. `npm run check:lines` runs without errors (no files yet, so no failures)
3. `npx tsc --noEmit` passes (after extensions are migrated)
4. `npx vitest run` runs (even if no tests yet)

# References

- @docs/specs/005-scripts-migration.md
