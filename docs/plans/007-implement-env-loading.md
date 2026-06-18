---
title: Implement Env Loading
description: Implement Env Loading
date: 2026-06-18
---

# Overview

Implement `common/env.ts` with the three-layer dotenv cascade. This module loads `~/.pi/agent/.env` (global) then `<cwd>/.pi/.env` (project-local) on top of hardcoded defaults.

# Goals

- `common/env.ts` exists with `configureEnv()` function
- Three-layer cascade works: defaults → global → project
- Lazy singleton: first call loads, subsequent calls are no-ops
- Tilde expansion works for path values

# Implementation Steps

- [ ] Install `dotenv` package: `npm install dotenv`
- [ ] Install `@types/dotenv` if needed (dotenv v16+ has built-in types)
- [ ] Create `common/env.ts` with:
  - [ ] `configureEnv(cwd?: string): void` — loads global then project `.env`
  - [ ] Default values as exported constants
  - [ ] `expandTilde(path: string): string` helper
  - [ ] Lazy guard (`let configured = false`)
- [ ] Verify `configureEnv` is called in each extension's default export
- [ ] Test with a local `.env` file to confirm cascade works

# Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| dotenv not installed | Low | High | npm install catches this |
| Tilde expansion doesn't work in path | Low | Medium | Implement expandTilde using os.homedir() |
| Race condition on first call | Low | Low | Single-threaded Node.js — no race possible |

# UAT

1. Create `~/.pi/agent/.env` with `TEST_VAR=global` and `<project>/.pi/.env` with `TEST_VAR=project`
2. Call `configureEnv(projectDir)` — verify `process.env.TEST_VAR === "project"`
3. Remove project `.env` — verify `process.env.TEST_VAR === "global"`
4. Remove both — verify `process.env.SEARXNG_PORT === "8888"` (default)
5. Call `configureEnv()` again — verify it's a no-op (already configured)

# References

- @docs/specs/007-env-loading-mechanism.md
