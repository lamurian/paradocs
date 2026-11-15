---
title: Migration Architecture
description: Defines which Cognoscere components migrate to paradocs and which are removed or simplified.
status: implemented
date: 2026-06-18
---

# Context

Paradocs is extracted from Cognoscere as a standalone pi package for PARA knowledge management. Cognoscere had 10 extensions, 8 skills, shared modules (_common/), and type stubs (@types/). Two extensions (set-temperature.ts, scope-gate.ts) are already handled by global extensions in ~/.pi/agent/extensions/ (model-temperature and sandbox respectively). roadmap-scratchpad is not useful for knowledge management. The remaining code needs to be migrated with a clean structure.

# Decision

Migrate 7 extensions (para-knowledge, web-search, link-summarizer, batch-create, expand-bullets, yaml-enforcer, skill-gate.ts), all 8 skills, all 3 shared modules (_common/* → common/*), and the citation-js type stub (@types/* → types/*). Remove set-temperature.ts, scope-gate.ts, and roadmap-scratchpad entirely. Straight rename _common/ to common/ and @types/ to types/ with no content changes. No src/ directory — extension directories are the source. Relative imports use `.ts` specifiers (`./helper.ts`), not `.js`. Amended after measurement: jiti cannot resolve `./helper.js` to `helper.ts` directly and goes through several failed resolution attempts per import (about 12ms per import versus about 0.4ms with `.ts`), which added about 3s to every pi start. The `.ts` convention is enforced by an ESLint `no-restricted-syntax` rule and `tests/no-js-specifiers.test.ts`.

# Impact

Cleaner package with focused scope. Removes dead weight (roadmap-scratchpad is unused, set-temperature and scope-gate are redundant). Developers new to the project can see exactly what paradocs provides without Cognoscere-specific baggage. Import paths keep their module structure, so no refactoring is needed beyond renaming directories and using `.ts` specifiers.
