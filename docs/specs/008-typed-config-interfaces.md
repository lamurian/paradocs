---
title: Typed Config Interfaces
description: Typed getter functions and interfaces for all configuration groups.
date: 2026-06-18
status: implemented
---

# Requirements Specification

- Export typed TypeScript interfaces for each configuration group
- Export synchronous getter functions that read from `process.env` after cascade
- All getters return values with hardcoded defaults (lowest layer)
- Expand `~` to home directory in path values (KNOWLEDGE_DIR)
- Parse numeric values from string env vars (ports)
- Every env var must have a sensible default so the package works without `.env`

## Config Interfaces

```typescript
export interface KnowledgeConfig {
  dir: string;      // KNOWLEDGE_DIR — path to PARA documents root
  db: string;       // KNOWLEDGE_DB — SQLite filename (relative to dir)
}

export interface SearxngConfig {
  port: number;     // SEARXNG_PORT
  host: string;     // SEARXNG_HOST
  secretKey: string; // SEARXNG_SECRET_KEY
  version: string;  // SEARXNG_VERSION
}

export interface ObscuraConfig {
  port: number;     // OBSCURA_PORT
  host: string;     // OBSCURA_HOST
  version: string;  // OBSCURA_VERSION
}

export interface ApiKeysConfig {
  tavily: string;    // TAVILY_KEY (optional, default "")
  github: string;    // GITHUB_TOKEN (optional, default "")
}
```

## Getter Functions

```typescript
export function getKnowledgeConfig(): KnowledgeConfig
export function getSearxngConfig(): SearxngConfig
export function getObscuraConfig(): ObscuraConfig
export function getApiKeys(): ApiKeysConfig
```

## Default Values

| Env Var | Default | Type |
|---|---|---|
| `KNOWLEDGE_DIR` | `~/data/personal/Documents/Cognoscere` | string (tilde-expanded) |
| `KNOWLEDGE_DB` | `notes.db` | string |
| `SEARXNG_PORT` | `8888` | number |
| `SEARXNG_HOST` | `127.0.0.1` | string |
| `SEARXNG_SECRET_KEY` | `thissisanotherthingtodo!` | string |
| `SEARXNG_VERSION` | `latest` | string |
| `OBSCURA_PORT` | `9222` | number |
| `OBSCURA_HOST` | `127.0.0.1` | string |
| `OBSCURA_VERSION` | `latest` | string |
| `TAVILY_KEY` | `""` | string |
| `GITHUB_TOKEN` | `""` | string |

## Helper Functions (Internal)

```typescript
/** Expand ~ to home directory. */
function expandTilde(path: string): string

/** Parse port as number with fallback. */
function parsePort(val: string | undefined, defaultVal: number): number
```

# Design Principles

- **Zero config**: All getters return sensible defaults — the package works without any `.env` file.
- **Type safety**: Every config value has a typed interface — no `process.env.X` string access in extensions.
- **Parse once**: Values are parsed at getter call time, not cached beyond the return value.
- **Synchronous**: No async initialization needed for config.

# References

- ADR 002: Environment Variable Configuration
- Spec 007: Env Loading Mechanism

This spec implements @docs/ADR/002-*.md
