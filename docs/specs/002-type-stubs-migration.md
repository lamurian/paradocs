---
title: Type Stubs Migration
description: Migrate citation-js type declarations from @types/ to types/.
date: 2026-06-18
---

# Requirements Specification

- Migrate `@types/citation-js.d.ts` from Cognoscere to paradocs `types/citation-js.d.ts`
- Rename directory `@types/` → `types/` — no content changes
- Update any import references to `@types/` → `types/` (though type stubs are typically auto-discovered via `include` in tsconfig)

## File Mapping

| Source (Cognoscere) | Destination (paradocs) | Purpose |
|---|---|---|
| `.pi/extensions/@types/citation-js.d.ts` | `types/citation-js.d.ts` | Ambient module declarations for `@citation-js/core`, `@citation-js/plugin-bibtex`, `@citation-js/plugin-doi`, `@citation-js/plugin-url` |

## tsconfig Update

Ensure `types/` is included in `tsconfig.json`:
```json
{
  "include": ["types/**/*.d.ts", "types/**/*.ts"]
}
```

# Design Principles

- **Minimal types**: Only declare what extensions actually use — no exhaustive coverage.
- **Ambient modules**: Use `declare module '...'` pattern, not explicit imports.

# References

- ADR 001: Migration Architecture

This spec implements @docs/ADR/001-*.md
