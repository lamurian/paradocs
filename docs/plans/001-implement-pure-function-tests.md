---
title: Implement Pure Function Tests
description: Implement Pure Function Tests
status: {{status}}
date: 2026-06-19
---

# Overview

Create test files for all exported pure functions in extensions that don't need network, SQLite, or filesystem access. These are the highest-leverage tests: easy to write, no mocking needed, high coverage contribution.

# Goals

- Achieve ≥80% coverage on tested source files
- Minimum 8 test files created covering all identified pure functions
- All tests pass on first run

# Implementation Steps

- [ ] Create `tests/para-knowledge/similarity.test.ts` — test wordTrigrams, jaccardSimilarity, textSimilarity
- [ ] Create `tests/para-knowledge/para-frontmatter.test.ts` — test parseFrontmatter, formatFrontmatter, yamlQuote
- [ ] Create `tests/expand-bullets/parser.test.ts` — test parseFrontmatter, extractBullets, buildSearchQuery
- [ ] Create `tests/expand-bullets/synthesis.test.ts` — test synthesizeExpansion
- [ ] Create `tests/link-summarizer/http-extract.test.ts` — test extractReadableText
- [ ] Create `tests/link-summarizer/pdf-helpers.test.ts` — test isPdfUrl, extractPdfTitle
- [ ] Create `tests/link-summarizer/tavily-extract.test.ts` — test addFailedUrl, getPendingUrls, clearPending, hasPending
- [ ] Create `tests/yaml-enforcer/analyzer.test.ts` — test analyzeFrontmatter with various YAML inputs
- [ ] Run `npm test` to verify all tests pass

# Risks

| Likelihood | Impact | Mitigation |
|---|---|---|
| Medium | Medium | Import errors due to `.js` extension resolution in vitest — check existing test patterns first |
| Low | Low | Some functions may not be exported as expected — verify exports before writing tests |

# UAT

1. Run `npm test` and confirm all new test files are picked up and pass
2. Run `npm run test:coverage` and verify coverage increased from ~5% to >40% for pure function modules
3. Inspect each test file for edge case coverage and realistic inputs


This plan implements @docs/specs/012-*.md
