---
title: Setup Pre-commit and Tests
description: Setup Pre-commit and Tests
date: 2026-06-18
---

# Overview

Set up Husky pre-commit hooks, vitest configuration, and the check-lines.mjs script. This enforces code quality gates before every commit.

# Goals

- Husky v9 pre-commit hook installed and configured
- Pre-commit pipeline: format → lint → typecheck → check-lines → test
- `vitest.config.ts` with coverage thresholds (70/60/70/70)
- `scripts/check-lines.mjs` working with 300-line limit
- `npm run prepare` hooks up Husky automatically

# Implementation Steps

- [ ] Create `vitest.config.ts` with coverage provider v8, thresholds (70/60/70/70), 30s timeout
- [ ] Copy `scripts/check-lines.mjs` from Cognoscere
- [ ] Initialize Husky: `npx husky init`
- [ ] Write `.husky/pre-commit` with the pipeline:
  - [ ] `npx prettier --write` (format)
  - [ ] `npx eslint --fix` (lint)
  - [ ] `npx tsc --noEmit` (typecheck)
  - [ ] `node scripts/check-lines.mjs` (line limit)
  - [ ] `npx vitest run --changed` (test changed)
- [ ] Add `"prepare": "husky"` script to package.json
- [ ] Run `npm run prepare` to verify Husky hooks are installed
- [ ] Create placeholder test file: `tests/common/slug.test.ts`
- [ ] Run `npx vitest run` to verify test runner works

# Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Husky version mismatch | Low | Medium | Pin to Cognoscere's husky version |
| vitest can't resolve imports | Medium | Medium | Verify resolve.alias or extensions config matches project structure |
| Pre-commit too slow | Medium | Low | Only staged files checked; vitest --changed limits test scope |

# UAT

1. `npm run prepare` runs without error
2. `.husky/pre-commit` exists and is executable
3. `npx vitest run` runs (may have zero tests — no failure)
4. Touch a file that exceeds 300 lines, stage it, try to commit — pre-commit hook blocks it
5. `node scripts/check-lines.mjs` reports line counts for all staged `.ts` files

# References

- @docs/specs/010-pre-commit-hooks-and-test-runner.md
