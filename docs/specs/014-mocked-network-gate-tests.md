---
title: Mocked Network & Gate Tests
description: Mocked Network & Gate Tests
status: implemented
remaining: 0
date: 2026-06-19
---

# Requirements Specification

- Test network-dependent modules by mocking `fetch`, `WebSocket`, `child_process.execSync`, and `pi.exec` at the vitest level.
- Modules under test:
  - `extensions/web-search/native.ts` — searchNativeHttp (mock `fetch` to return RSS XML)
  - `extensions/web-search/searxng.ts` — searchSearxng (mock `fetch` to return SearXNG JSON)
  - `extensions/web-search/tavily.ts` — searchTavily (mock `fetch` to return Tavily JSON; mock `getApiKeys`)
  - `extensions/link-summarizer/cdp.ts` — tryObscura (mock `WebSocket`)
  - `extensions/link-summarizer/pdf.ts` — checkPdfContentType, tryExtractPdf (mock `fetch` + `execSync`)
  - `extensions/expand-bullets/search.ts` — searchWeb (mock `pi.exec`)
  - `extensions/skill-gate.ts` — isParaPath, gateCreate, warnGate, turn/session lifecycle

# Design Principles

- Use `vi.mock()` to mock entire modules, `vi.spyOn()` to mock individual functions.
- For `fetch` mocking: mock at the global level with `vi.stubGlobal('fetch', mockFn)`.
- For `WebSocket` mocking: create a minimal fake WebSocket class.
- For `child_process`: mock `execSync` to return controlled output.
- For skill-gate: test `isParaPath` logic directly (extract into exported helper if needed), test gate state transitions with event simulation.
- Mock responses should include realistic XML/JSON payloads matching the real API shapes.

# References

- ADR 005: Unit Test Strategy & Coverage Gates
- vitest mocking guide: vi.mock, vi.spyOn, vi.stubGlobal


This spec implements @docs/ADR/005-*.md
