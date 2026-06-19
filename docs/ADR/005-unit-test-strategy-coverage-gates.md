---
title: Unit Test Strategy & Coverage Gates
description: Comprehensive unit tests for all extensions and common modules with ≥80% coverage enforced as a hard gate.
status: proposed
remaining: 0
date: 2026-06-19
---

# Context

The Paradocs project has 7 pi extensions (para-knowledge, web-search, link-summarizer, batch-create, expand-bullets, yaml-enforcer), a skill-gate interceptor, and 4 shared modules (slug, tokenize, yaml, env). Currently, only the shared common modules have unit tests (covering ~5% of the overall codebase). The extensions — which constitute the bulk of the code — have zero test coverage.

The team needs ≥80% coverage across all statements, branches, functions, and lines, enforced as a hard gate in the vitest config. Network-dependent modules (web-search SearXNG/Tavily/Bing, link-summarizer CDP/HTTP/PDF, expand-bullets search) must be tested via mocked fetch/WebSocket/child_process layers rather than hitting real services. The existing common module tests should be retained and their coverage re-verified.

Options considered:
1. Integration tests only (slow, brittle, no isolation) — rejected
2. Snapshot tests (brittle, hard to maintain) — rejected
3. Pure unit tests with dependency injection and mocking — chosen
4. E2E tests as supplement (post-MVP) — deferred

# Decision

Adopt a pure unit-test strategy with mocked dependencies using vitest's built-in mocking (vi.mock, vi.spyOn). Each extension module gets its own test file(s) testing exported functions in isolation. Network calls are mocked at the fetch/child_process level. SQLite-dependent modules are tested with :memory: databases via node:sqlite. Filesystem-dependent modules use temporary directories (mkdtempSync). The vitest config thresholds are raised to 80/70/80/80 (statements/branches/functions/lines). The npm `test` script is updated to enforce coverage via --coverage, and the pre-commit hook includes coverage check.

# Impact

Benefits: Catches regressions early; documents expected behavior of pure functions; enables confident refactoring. Trade-offs: ~40 new test files to maintain; test runtime increases (estimated 2-5x); some functions (tool handlers) are harder to test without full pi API mocking and may need to be tested through their pure sub-functions only. The coverage threshold may occasionally block commits during refactoring but provides a clear quality floor.
