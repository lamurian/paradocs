---
title: Migrate Type Stubs
description: Migrate Type Stubs
date: 2026-06-18
---

# Overview

Copy `citation-js.d.ts` from Cognoscere's `@types/` to paradocs `types/`. Straight rename with tsconfig update.

# Goals

- `types/citation-js.d.ts` exists with correct ambient declarations
- `tsconfig.json` includes `types/` in its scope
- TypeScript compiles cleanly

# Implementation Steps

- [ ] Copy `@types/citation-js.d.ts` → `types/citation-js.d.ts`
- [ ] Verify `tsconfig.json` include array covers `types/**/*.d.ts`
- [ ] Run `npx tsc --noEmit` to verify

# Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Missing type causes compile errors | Low | High | tsc --noEmit catches this; package has citation-js deps installed |

# UAT

1. Verify `types/citation-js.d.ts` exists
2. Run `npx tsc --noEmit` — must pass

# References

- @docs/specs/002-type-stubs-migration.md
