---
title: Implement Skill Gate
description: Implement Skill Gate
date: 2026-06-18
---

# Overview

Implement `extensions/skill-gate.ts` as an event interceptor that enforces the search-first-ask-later workflow. Soft warnings guide the agent without blocking. Adapted from Cognoscere's skill-gate.ts with re-scoped workflow rules.

# Goals

- `extensions/skill-gate.ts` registers event handlers for session_start, turn_start, tool_call, tool_result, tool_execution_start
- Workflow rules implemented: search before create, read before edit, search before write
- `/bypass-gate` command registered
- Circuit breaker: unhandled rejection disables gate gracefully
- All state resets per turn and per session

# Implementation Steps

- [ ] Create `extensions/skill-gate.ts`:
  - [ ] Define `TurnState` and `SessionState` interfaces
  - [ ] Implement lifecycle handlers: `session_start` (reset session), `turn_start` (reset turn)
  - [ ] Implement `tool_execution_start` handler: track `search_para_docs` calls
  - [ ] Implement `tool_result` handler: parse search results count and PARA file paths
  - [ ] Implement `tool_call` handler for `read`: track PARA file reads
  - [ ] Implement `tool_call` handler for `create_para_doc`/`batch_create_para_docs`: Rule 1 (search before create)
  - [ ] Implement `tool_call` handler for `write`/`edit`: Rule 2 (search before write to PARA dir)
  - [ ] Implement `tool_call` handler for `edit`/`update_para_doc`: Rule 3 (read before edit)
  - [ ] Implement `/bypass-gate` command: `pi.registerCommand("bypass-gate", ...)`
  - [ ] Implement circuit breaker: `process.on("unhandledRejection", ...)`
  - [ ] Add PARA path pattern matching (`/^Resources\//`, `/^Projects\//`, `/^Areas\//`, `/^Archives\//`)
- [ ] Update `extensions/AGENTS.md` to list skill-gate.ts
- [ ] Run `npx tsc --noEmit` to verify
- [ ] Run `node scripts/check-lines.mjs` to verify ≤300 lines

# Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| ~200 lines close to 300 limit | Medium | Low | File was 197 lines in Cognoscere; re-scoped version should be similar. Split into helpers if needed. |
| Event handler conflicts with other extensions | Low | Medium | skill-gate only uses events that other extensions typically don't intercept (tool_execution_start, tool_result) |
| Bypass command persists across sessions | Low | Low | session_start resets bypass flag |

# UAT

1. Load pi with paradocs extensions — `/reload` succeeds
2. Call `search_para_docs` then `create_para_doc` — no warning
3. Call `create_para_doc` without searching — warning appears
4. Read a PARA file via `read`, then `edit` it — no warning
5. `edit` a PARA file without reading first — warning appears
6. Write to PARA dir without searching — warning appears
7. Call `/bypass-gate` — all warnings suppressed for the session
8. Start a new turn — warnings resume (turn state resets)

# References

- @docs/specs/011-skill-gate-implementation.md
