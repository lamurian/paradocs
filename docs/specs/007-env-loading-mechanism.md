---
title: Env Loading Mechanism
description: Design of common/env.ts for three-layer dotenv cascade loading.
date: 2026-06-18
---

# Requirements Specification

- Single `common/env.ts` module that loads environment variables in three layers
- Layer 1: Hardcoded default values (lowest priority)
- Layer 2: `~/.pi/agent/.env` global user config (overrides defaults)
- Layer 3: `<project>/.pi/.env` project-local config (highest priority, overrides all)
- All layers cascade into `process.env` so standard `process.env.X` reads work
- Export `configureEnv(cwd?: string)` function that performs the cascade
- Lazy singleton pattern — first call loads, subsequent calls are no-ops
- Support `~` expansion in path-like env vars

## Implementation Design

```typescript
// common/env.ts
import { config } from "dotenv";
import { resolve, homedir } from "node:path";
import { existsSync } from "node:fs";

let configured = false;

export function configureEnv(cwd?: string): void {
  if (configured) return;
  configured = true;

  // Layer 2: Global config (without override — defaults sit in process.env)
  const globalEnv = resolve(homedir(), ".pi", "agent", ".env");
  if (existsSync(globalEnv)) {
    config({ path: globalEnv });
  }

  // Layer 3: Project config (with override — beats global)
  if (cwd) {
    const projectEnv = resolve(cwd, ".pi", ".env");
    if (existsSync(projectEnv)) {
      config({ path: projectEnv, override: true });
    }
  }
}
```

## Auto-init Pattern

Each extension calls `configureEnv()` at the top of its factory function or in `session_start`. A lightweight variant `configureEnv(cwd)` can be called from each extension's default export.

## Default Values (Lowest Layer)

Default values are defined as exported constants and used by the typed getters (see Spec 008: Typed Config Interfaces). They are applied to `process.env` only if the variable is not already set.

# Design Principles

- **Standard Node.js**: Uses `dotenv` and `process.env` — no custom config parsers.
- **Lazy loading**: First call wins; subsequent calls skip to avoid re-reading.
- **Override semantics**: Later layers win over earlier ones via `dotenv`'s `override` option.
- **Works without calling configureEnv**: Getters fall back to `process.env` defaults for pre-set environments.

# References

- ADR 002: Environment Variable Configuration
- `dotenv` npm package documentation

This spec implements @docs/ADR/002-*.md
