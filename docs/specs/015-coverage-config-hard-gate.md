---
title: Coverage Config & Hard Gate
description: Coverage Config & Hard Gate
status: implemented
remaining: 0
date: 2026-06-19
---

# Requirements Specification

- Update vitest.config.ts to raise global coverage thresholds to 80/70/80/80 (statements/branches/functions/lines).
- Update the npm `test` script to run with `--coverage` so coverage is checked on every `npm test`.
- Update the pre-commit hook (in `.husky/pre-commit` and `package.json`'s `precommit` script) to run coverage-gated tests.
- Ensure all existing tests continue to pass after config changes.
- Common modules (slug, tokenize, yaml, env) are already tested; their coverage contribution is retained.
- The coverage include pattern in vitest config must cover `extensions/**/*.ts` and `common/**/*.ts`.

# Design Principles

- Hard gate: `npm test` fails if coverage is below thresholds — no separate `test:coverage` step needed.
- Pre-commit already runs `npm test` via the `precommit` script — coverage enforcement comes for free.
- Thresholds are checked globally, not per-file (avoids flaky per-file failures during partial refactors).
- The experimental `node:sqlite` warning is suppressed in vitest config or via `--experimental-sqlite` flag.

# References

- ADR 005: Unit Test Strategy & Coverage Gates
- Current `vitest.config.ts` thresholds: 70/60/70/70
- Current `package.json` scripts and husky config


This spec implements @docs/ADR/005-*.md
