---
title: Configure Coverage Hard Gate
description: Configure Coverage Hard Gate
status: {{status}}
date: 2026-06-19
---

# Overview

Update vitest.config.ts with 80/70/80/80 thresholds, update npm scripts to run coverage on every test, and ensure the pre-commit hook enforces coverage.

# Goals

- `npm test` fails if thresholds not met
- Pre-commit blocks commits below threshold
- All existing tests continue to pass

# Implementation Steps

- [ ] Update `vitest.config.ts` — raise thresholds to statements: 80, branches: 70, functions: 80, lines: 80
- [ ] Update `package.json` `test` script — add `--coverage` flag
- [ ] Update `package.json` `precommit` script — ensure `npm test` is already included (runs coverage-gated tests)
- [ ] Run `npm test` to verify config changes work and thresholds are enforced
- [ ] Verify `npm test` fails if coverage is below threshold (run with limited test set to confirm)

# Risks

| Likelihood | Impact | Mitigation |
|---|---|---|
| Low | High | Threshold too strict for current codebase — mitigate by writing tests first, then raising thresholds last |
| Low | Low | Test runtime increases due to coverage collection — acceptable trade-off |

# UAT

1. Run `npm test` and confirm tests pass with coverage check
2. Verify failure mode: temporarily reduce a threshold below actual coverage, confirm `npm test` fails
3. Confirm pre-commit hook runs coverage-gated tests on commit attempt


This plan implements @docs/specs/015-*.md
