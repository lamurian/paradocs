---
title: Scripts Migration
description: Migrate build scripts and tooling from Cognoscere to paradocs.
date: 2026-06-18
---

# Requirements Specification

- Migrate `scripts/check-lines.mjs` from Cognoscere — the 300-line file limit enforcer
- Migrate `package.json` — inherit all devDependencies and scripts from Cognoscere
- Migrate `tsconfig.json` — TypeScript strict configuration
- Create project root `package.json` with package name `paradocs`
- Install all dependencies: runtime (`@citation-js/core`, `@citation-js/plugin-bibtex`, `@citation-js/plugin-doi`, `@citation-js/plugin-url`, `@tavily/core`, `dotenv`) and devDependencies (typescript, eslint, prettier, husky, vitest, etc.)

## File Mapping

| Source (Cognoscere) | Destination (paradocs) |
|---|---|
| `package.json` | `package.json` (adapted) |
| `tsconfig.json` | `tsconfig.json` |
| `eslint.config.js` | `eslint.config.js` |
| `vitest.config.ts` | `vitest.config.ts` |
| `scripts/check-lines.mjs` | `scripts/check-lines.mjs` |

## package.json Changes

- Name: `"cognoscere"` → `"paradocs"`
- Description: `"PARA knowledge base and pi extensions for Cognoscere"` → `"PARA knowledge management for pi"`
- Keep all dependencies and scripts from Cognoscere
- Add `dotenv` to runtime dependencies
- Remove any Cognoscere-specific scripts (none identified)

## Scripts to Preserve

- `test`: `"vitest run"`
- `test:watch`: `"vitest"`
- `test:coverage`: `"vitest run --coverage"`
- `test:changed`: `"vitest run --changed"`
- `lint`: `"eslint extensions/ common/"`
- `lint:fix`: `"eslint extensions/ common/ --fix"`
- `format`: `"prettier --write extensions/ common/"`
- `format:check`: `"prettier --check extensions/ common/"`
- `typecheck`: `"tsc --noEmit"`
- `check:lines`: `"node scripts/check-lines.mjs"`
- `prepare`: `"husky"`

# Design Principles

- **Mirror Cognoscere**: Same tooling, same scripts, same config approach.
- **Adapt paths**: Update lint/format paths from `.pi/extensions/` to `extensions/` and `common/`.

# References

- ADR 001: Migration Architecture

This spec implements @docs/ADR/001-*.md
