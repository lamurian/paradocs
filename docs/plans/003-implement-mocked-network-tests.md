---
title: Implement Mocked Network Tests
description: Implement Mocked Network Tests
status: {{status}}
date: 2026-06-19
---

# Overview

Create test files for network-dependent modules using vitest mocking (fetch, WebSocket, child_process, pi.exec). Also test skill-gate logic (isParaPath, gate state machine).

# Goals

- All network calls mocked at the transport layer
- Realistic mock payloads matching real API shapes
- Skill-gate state transitions tested with event simulation

# Implementation Steps

- [ ] Create `tests/web-search/native-search.test.ts` — mock `fetch` to return Bing RSS XML, test searchNativeHttp
- [ ] Create `tests/web-search/searxng-search.test.ts` — mock `fetch` to return SearXNG JSON, test searchSearxng
- [ ] Create `tests/web-search/tavily-search.test.ts` — mock `fetch` + mock `getApiKeys`, test searchTavily
- [ ] Create `tests/link-summarizer/cdp-obscura.test.ts` — mock `WebSocket`, test tryObscura
- [ ] Create `tests/link-summarizer/pdf-extraction.test.ts` — mock `fetch` HEAD + `execSync`, test checkPdfContentType, tryExtractPdf
- [ ] Create `tests/expand-bullets/web-search.test.ts` — mock `pi.exec`, test searchWeb
- [ ] Create `tests/skill-gate.test.ts` — test isParaPath (extract as exported helper), gate state transitions, warnGate
- [ ] Run `npm test` to verify all tests pass

# Risks

| Likelihood | Impact | Mitigation |
|---|---|---|
| High | Medium | Mock setup is complex for WebSocket and multi-level modules — use simple mock implementations first |
| Medium | Medium | skill-gate.ts has private functions — consider extracting isParaPath as a named export for testability |
| Low | Low | Mock data needs to match real API shapes — use realistic examples from actual API docs |

# UAT

1. Run `npm test` and confirm all mocked network tests pass without real network access
2. Verify coverage on mocked modules shows ≥80%
3. For skill-gate: verify gate logic correctly handles bypassed/healthy/abnormal states


This plan implements @docs/specs/014-*.md
