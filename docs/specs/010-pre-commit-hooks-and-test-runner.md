---
title: Pre-commit Hooks and Test Runner
description: Husky pre-commit pipeline, vitest configuration, and line-limit enforcement.
date: 2026-06-18
status: implemented
---

# Requirements Specification

- Husky v9 pre-commit hook running format → lint → typecheck → line-limit → test
- vitest test runner with coverage thresholds
- check-lines.mjs script enforcing 300-line max per file
- All checks must pass before commit — no `--no-verify` workaround
- Test files mirror source structure under `tests/`

## Pre-commit Pipeline

`.husky/pre-commit` runs staged files through:
1. **Format**: `npx prettier --write` (auto-format staged `.ts` files)
2. **Lint**: `npx eslint --fix` (lint and auto-fix staged `.ts` files)
3. **Typecheck**: `npx tsc --noEmit` (full project typecheck)
4. **Line limit**: `node scripts/check-lines.mjs` (scan all staged `.ts` files)
5. **Test**: `npx vitest run --changed` (run tests for changed files)

If any step fails, the commit is blocked. Fix the issue, re-stage, and retry.

## check-lines.mjs

```javascript
// Migrated from Cognoscere — unchanged logic
// Reads staged .ts files, counts total lines (including blanks/comments)
// Exits non-zero if any file exceeds 300 lines
// Reports: "FAIL: path/to/file.ts (312 lines)"
```

## vitest.config.ts

```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["extensions/**/*.ts", "common/**/*.ts"],
      exclude: ["**/node_modules/**", "**/*.d.ts"],
      thresholds: {
        statements: 70,
        branches: 60,
        functions: 70,
        lines: 70,
      },
    },
    testTimeout: 30_000,
  },
  resolve: {
    extensions: [".ts", ".js", ".json"],
  },
});
```

## Test File Convention

Tests mirror source structure:
- `common/slug.ts` → `tests/common/slug.test.ts`
- `extensions/para-knowledge/tools/searchDocs.ts` → `tests/extensions/para-knowledge/tools/searchDocs.test.ts`

## Husky Setup

```bash
npx husky init
# Creates .husky/pre-commit with the pipeline
# The prepare script in package.json runs "husky" automatically on install
```

# Design Principles

- **Fast feedback**: `vitest --changed` runs only tests for changed files.
- **Fail fast**: Pipeline stops at first failure; no point continuing after typecheck fails.
- **Enforce limits**: 300-line cap prevents monolithic files before they happen.
- **No escape hatch**: `--no-verify` is not an option — fix the issue or the commit doesn't land.

# References

- ADR 003: Toolchain and Quality Gates
- Spec 009: TypeScript and ESLint Configuration
- Cognoscere `.husky/pre-commit`, `vitest.config.ts`, `scripts/check-lines.mjs`

This spec implements @docs/ADR/003-*.md
