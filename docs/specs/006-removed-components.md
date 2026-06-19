---
title: Removed Components
description: Document what Cognoscere components are excluded from migration and why.
date: 2026-06-18
status: implemented
---

# Requirements Specification

- Document the 3 Cognoscere components being removed from migration
- Provide clear rationale for each removal
- Verify no other extension or skill depends on the removed components

## Removed Components

### 1. `set-temperature.ts`
- **Source**: `.pi/extensions/set-temperature.ts` (8 lines)
- **Purpose**: Overrode model temperature to 0.1 via `before_provider_request` event
- **Reason**: Already handled by global extension `~/.pi/agent/extensions/model-temperature/` which provides richer temperature management (config file, per-model settings)
- **Dependencies**: None — no other extension or skill references it

### 2. `scope-gate.ts`
- **Source**: `.pi/extensions/scope-gate.ts` (122 lines)
- **Purpose**: Blocked writes/reads outside working directory and to .env files
- **Reason**: Already handled by global extension `~/.pi/agent/extensions/sandbox/` which provides configurable filesystem and network guardrails via `sandbox.json`
- **Dependencies**: None — no other extension or skill references it

### 3. `roadmap-scratchpad/`
- **Source**: `.pi/extensions/roadmap-scratchpad/` (5 files, ~740 total lines)
- **Purpose**: Learning pathway state tracker with its own SQLite database
- **Reason**: Not useful for knowledge management. The roadmap skill (`skills/roadmap/SKILL.md`) provides the workflow without needing a state-tracker extension
- **Dependencies**: None — no other extension imports from roadmap-scratchpad

## Verification Checklist

- [ ] No import in any migrated file references `roadmap-scratchpad`
- [ ] No skill mentions `roadmap-scratchpad` tools
- [ ] `set-temperature` and `scope-gate` are confirmed working via global extensions

# Design Principles

- **Don't carry dead weight**: If a global extension already provides the functionality, don't duplicate it.
- **Keep scope tight**: The package is about knowledge management — roadmap planning is out of scope.
- **Verify no breakage**: Each removal is checked for dependents before proceeding.

# References

- ADR 001: Migration Architecture

This spec implements @docs/ADR/001-*.md
