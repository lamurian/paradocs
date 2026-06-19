---
title: Toolchain and Quality Gates
description: TypeScript strict, ESLint, Prettier, Husky pre-commit with static checks, and vitest for testing.
status: implemented
date: 2026-06-18
---

# Context

Cognoscere already has a working toolchain (TypeScript strict, ESLint with complexity ≤15, Prettier, Husky pre-commit, vitest with coverage thresholds). Paradocs needs the same level of quality enforcement as a standalone pi package. The pi extension docs recommend TypeScript strict mode and the extension AGENTS.md from Cognoscere enforces max 300 lines per file, cyclomatic complexity ≤15, and import ordering.

# Decision

Adopt the same toolchain as Cognoscere with enhancements. TypeScript strict mode with noEmit and bundler module resolution. ESLint with complexity: ["error", 15] and typescript-eslint rules. Prettier for auto-formatting. Husky pre-commit hook that runs: format → lint → typecheck → check-lines (max 300 per file) → test changed. Vitest with coverage thresholds (statements 70%, branches 60%, functions 70%, lines 70%). The check-lines script from Cognoscere (scripts/check-lines.mjs) is migrated as-is. All devDependencies mirror Cognoscere: typescript, eslint, prettier, husky, vitest, @types/node.

# Impact

Consistent code quality across the project. The 300-line limit keeps files focused and encourages modularization. Pre-commit hooks catch issues early. Developers get immediate feedback from lint and type checking. Coverage thresholds prevent untested code from landing. The trade-off is slower commits (pre-commit checks take a few seconds) and the need to maintain CI configuration alongside the hooks.
