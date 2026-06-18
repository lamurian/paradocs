---
title: Implement Typed Config
description: Implement Typed Config
date: 2026-06-18
---

# Overview

Add typed getter functions and interfaces to `common/env.ts` for each configuration group. Each getter reads from `process.env` with a hardcoded default.

# Goals

- Typed interfaces: `KnowledgeConfig`, `SearxngConfig`, `ObscuraConfig`, `ApiKeysConfig`
- Typed getters: `getKnowledgeConfig()`, `getSearxngConfig()`, `getObscuraConfig()`, `getApiKeys()`
- All getters return synchronous, correct values after env cascade
- All extensions updated to use typed getters instead of raw `process.env`

# Implementation Steps

- [ ] Add interfaces to `common/env.ts`: KnowledgeConfig, SearxngConfig, ObscuraConfig, ApiKeysConfig
- [ ] Add `parsePort(val: string | undefined, defaultVal: number): number` helper
- [ ] Add getter functions with default values:
  - [ ] `getKnowledgeConfig()` — reads KNOWLEDGE_DIR (tilde-expanded), KNOWLEDGE_DB
  - [ ] `getSearxngConfig()` — reads SEARXNG_PORT/HOST/SECRET_KEY/VERSION
  - [ ] `getObscuraConfig()` — reads OBSCURA_PORT/HOST/VERSION
  - [ ] `getApiKeys()` — reads TAVILY_KEY, GITHUB_TOKEN
- [ ] Update all extensions to replace raw `process.env` access with typed getters
  - [ ] `para-knowledge/` — replace DB path construction
  - [ ] `web-search/` — replace SEARXNG host/port/key
  - [ ] `link-summarizer/` — replace OBSCURA host/port, TAVILY_KEY
  - [ ] `yaml-enforcer/` — none (no env deps)
  - [ ] `batch-create/` — none (no env deps)
  - [ ] `expand-bullets/` — none (no env deps)
  - [ ] `skill-gate.ts` — none (no env deps)
- [ ] Run `npx tsc --noEmit` to verify

# Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Missed raw process.env access | Medium | Low | grep for process.env after migration; update gradually |
| Typo in env var name | Low | Medium | Match exact names from spec; getter function name acts as documentation |

# UAT

1. Call each getter with no .env files — verify defaults are returned
2. Set KNOWLEDGE_DIR in project .env — verify getKnowledgeConfig().dir returns the new value
3. Set SEARXNG_PORT=9999 — verify getSearxngConfig().port === 9999
4. Run `grep -r 'process\.env\.\(KNOWLEDGE\|SEARXNG\|OBSCURA\|TAVILY\|GITHUB\)' extensions/` — zero results (all replaced by getters)
5. `npx tsc --noEmit` passes

# References

- @docs/specs/008-typed-config-interfaces.md
