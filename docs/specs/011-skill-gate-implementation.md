---
title: Skill Gate Implementation
description: Event interceptor behavior design for search-first workflow enforcement.
date: 2026-06-18
---

# Requirements Specification

- Event-based extension (no tools — only `pi.on()` handlers)
- Track agent turn lifecycle: `session_start`, `turn_start`, `turn_end`
- Intercept tool calls: `search_para_docs`, `create_para_doc`, `batch_create_para_docs`, `web_search`, `write`, `edit`, `update_para_doc`
- Detect `read` tool calls on PARA paths (Projects/, Areas/, Resources/, Archives/)
- Soft warnings via `ctx.ui.notify()` — never blocks execution
- `/bypass-gate` command to suspend all warnings session-wide
- Circuit breaker: on unhandled rejection, gate disables itself gracefully

## Workflow Rules

### Rule 1 — Search Before Create
When `create_para_doc` or `batch_create_para_docs` is called:
- If `search_para_docs` was not called this turn → warn: "Creating document without search first."
- If search returned 0 results → warn: "No existing docs found. Creating new document."
- If search returned results > 0 → warn: "Search found N existing doc(s). Creating anyway."
- If search is still running (parallel execution) → let it pass silently

### Rule 2 — Write/Edit to PARA Dir
When `write` or `edit` targets a PARA path (Projects/, Areas/, Resources/):
- If no search was started this turn → warn: "Writing to PARA dir without search first."

### Rule 3 — Edit/Update Without Reading
When `edit` or `update_para_doc` targets a PARA file:
- If the file was not read this turn → warn: "Editing/Updating without reading it first."
- Track read via `tool_call` on PARA file `read` events

### Rule 4 — Web Search Trigger
Track search result count. If `web_search` is called after a search returned 0 results → no warning (expected flow).
If `web_search` is called without a prior search → no warning (user may want fresh data).

### Rule 5 — Evidence Update
When user explicitly demands evidence update (web_search called after initial creation):
- Pass through without warning — this is intentional workflow

## State Model

```typescript
interface TurnState {
  searchStarted: boolean;
  searchResultCount: number;    // -1 = not done, 0 = empty, >0 = has results
  readParaFiles: Set<string>;   // PARA files read this turn
}

interface SessionState {
  bypassed: boolean;             // User suspended gates via /bypass-gate
  healthy: boolean;              // false = gate crashed, fail-closed
}
```

## Events Listened

| Event | Handler |
|---|---|
| `session_start` | Reset session state, clear bypass flag |
| `turn_start` | Reset turn state (searchStarted=false, searchResultCount=-1, clear readParaFiles) |
| `tool_execution_start` | Set `searchStarted = true` when toolName is `search_para_docs` |
| `tool_result` | Parse search_para_docs results: count matches, extract PARA file paths from result links |
| `tool_call` (read) | If input path matches PARA pattern, add to `turn.readParaFiles` |
| `tool_call` (create/update/write/edit) | Apply workflow rules, warn via `ctx.ui.notify` |
| Unhandled rejection | Set `session.healthy = false`, log error — gate disables itself |

## PARA Path Patterns

```typescript
const PARA_PATTERNS = [/^Resources\//, /^Projects\//, /^Areas\//, /^Archives\//];
```

## User Commands

- `/bypass-gate` — Register via `pi.registerCommand()`. Sets `session.bypassed = true`, notifies user.

# Design Principles

- **Soft gating**: Warnings, not blocks. The agent always proceeds — the gate informs, doesn't obstruct.
- **Per-turn tracking**: State resets each turn. The agent must search each turn before creating.
- **Fail-closed**: If the gate crashes, it disables itself so it doesn't break the agent.
- **User override**: `/bypass-gate` lets power users skip all warnings for the session.
- **Circuit breaker**: On unhandled rejection, gate becomes a no-op pass-through.

# References

- ADR 004: Skill Gate Workflow Enforcement
- Cognoscere `.pi/extensions/skill-gate.ts`

This spec implements @docs/ADR/004-*.md
