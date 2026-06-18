---
title: TypeScript and ESLint Configuration
description: TypeScript strict mode, ESLint rules, Prettier, and tsconfig setup.
date: 2026-06-18
---

# Requirements Specification

- TypeScript strict mode — no implicit any, strict null checks, etc.
- ESLint with complexity cap of 15 per function
- Prettier for consistent formatting
- All config files at project root

## tsconfig.json

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "esModuleInterop": true,
    "strict": true,
    "skipLibCheck": true,
    "noEmit": true,
    "isolatedModules": true,
    "declaration": false,
    "allowImportingTsExtensions": true,
    "resolveJsonModule": true,
    "types": ["node"]
  },
  "include": [
    "extensions/**/*.ts",
    "extensions/**/*.d.ts",
    "common/**/*.ts",
    "types/**/*.d.ts",
    "scripts/**/*.mjs",
    "tests/**/*.ts"
  ],
  "exclude": ["node_modules"]
}
```

## eslint.config.js

Flat config (ESLint v9+):
- Extends `typescript-eslint/strict-type-checked`
- Custom complexity rule: `complexity: ["error", 15]`
- Import ordering: external → internal → type-only (blank-line separated)
- Ignores: `["node_modules"]`

## .prettierrc (or prettier config in eslint)

```json
{
  "semi": true,
  "singleQuote": false,
  "trailingComma": "all",
  "printWidth": 100,
  "tabWidth": 2
}
```

## Naming Conventions (Enforced by ESLint)

| Element | Convention | Example |
|---|---|---|
| Files | kebab-case | `search-docs.ts` |
| Functions | camelCase | `searchDocuments()` |
| Classes | PascalCase | `SearchEngine` |
| Constants | UPPER_SNAKE_CASE | `MAX_RESULTS` |
| Types/Interfaces | PascalCase | `SearchResult` |

# Design Principles

- **Strict from day one**: No incremental adoption — full strict mode from the start.
- **Complexity budget**: 15 keeps functions focused without being overly restrictive.
- **Import hygiene**: External packages first, then internal modules, then type-only imports — each group separated by a blank line.
- **Auto-format**: Prettier eliminates formatting debates.

# References

- ADR 003: Toolchain and Quality Gates
- Cognoscere `tsconfig.json`, `eslint.config.js`

This spec implements @docs/ADR/003-*.md
