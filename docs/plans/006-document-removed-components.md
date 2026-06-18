---
title: Document Removed Components
description: Document Removed Components
date: 2026-06-18
---

# Overview

The spec for removed components is already written as documentation. No implementation work needed — this plan confirms the removal is complete once verified.

# Goals

- Confirm `set-temperature.ts`, `scope-gate.ts`, `roadmap-scratchpad/` are not migrated
- Verify no remaining references in migrated code

# Implementation Steps

- [ ] Confirm `extensions/set-temperature.ts` does not exist
- [ ] Confirm `extensions/scope-gate.ts` does not exist
- [ ] Confirm `extensions/roadmap-scratchpad/` does not exist
- [ ] Verify global `~/.pi/agent/extensions/model-temperature/` is active
- [ ] Verify global `~/.pi/agent/extensions/sandbox/` is active
- [ ] Run `grep -r 'roadmap-scratchpad\|set-temperature\|scope-gate' extensions/ common/ skills/` — must return zero results

# Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Import reference to removed component | Low | Medium | Grep check catches this |
| Global extension not active | Low | Medium | Verify by checking ~/.pi/agent/extensions/ |

# UAT

1. `ls extensions/set-temperature.ts` returns "No such file"
2. `ls extensions/scope-gate.ts` returns "No such file"
3. `ls -d extensions/roadmap-scratchpad` returns "No such directory"
4. `ls ~/.pi/agent/extensions/model-temperature/` exists and has an entry point
5. `ls ~/.pi/agent/extensions/sandbox/` exists and has an entry point

# References

- @docs/specs/006-removed-components.md
