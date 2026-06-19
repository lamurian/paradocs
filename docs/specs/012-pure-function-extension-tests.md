---
title: Pure Function Extension Tests
description: Pure Function Extension Tests
status: proposed
remaining: 0
date: 2026-06-19
---

# Requirements Specification

- Test all exported pure functions across extension modules that don't require network, SQLite, or filesystem access.
- Functions must be tested with realistic inputs covering normal, edge, and error cases.
- Shared state between tests must be isolated (fresh setup per test).
- Modules under test:
  - `extensions/para-knowledge/similarity.ts` — wordTrigrams, jaccardSimilarity, textSimilarity
  - `extensions/para-knowledge/frontmatter.ts` — parseFrontmatter, formatFrontmatter, yamlQuote
  - `extensions/expand-bullets/parser.ts` — parseFrontmatter, extractBullets, buildSearchQuery
  - `extensions/expand-bullets/synthesis.ts` — synthesizeExpansion
  - `extensions/link-summarizer/http.ts` — extractReadableText
  - `extensions/link-summarizer/pdf.ts` — isPdfUrl, extractPdfTitle
  - `extensions/link-summarizer/tavily-extract.ts` — addFailedUrl, getPendingUrls, clearPending, hasPending
  - `extensions/yaml-enforcer/analyzer.ts` — analyzeFrontmatter

# Design Principles

- One test file per source module, placed in `tests/<extension-name>/`.
- Use `vitest` with `describe`/`it`/`expect`.
- Import via dynamic `import()` with `.js` extension (matching project convention).
- Pure functions need no mocking — test with direct assertions.
- Cover: normal cases, edge cases (empty strings, special characters, boundary values), and error/fallback paths.

# References

- ADR 005: Unit Test Strategy & Coverage Gates
- Common module tests in `tests/common/slug.test.ts`, `tests/tokenize.test.ts`, `tests/yaml.test.ts` (existing patterns)


This spec implements @docs/ADR/005-*.md
