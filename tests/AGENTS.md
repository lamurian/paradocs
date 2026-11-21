# Tests

Vitest tests for extensions, shared modules and repository documentation. Tests
mirror the source layout and live under `tests/`.

## Conventions

- File naming: `<module>.test.ts` for a module, or a focused behavior name.
- Shared modules: `tests/common/*.test.ts` (one file per `common/` module).
- Extensions: `tests/<extension>/*.test.ts`, for example
  `tests/para-knowledge/`, `tests/para-evidence/`, `tests/para-outbox/`,
  `tests/para-recall/`, `tests/web-search/`, `tests/link-summarizer/` and
  `tests/yaml-enforcer/`.
- Repository checks: root-level files such as `tests/check-lines.test.ts`,
  `tests/package-manifest.test.ts`, `tests/doc-status.test.ts` and
  `tests/no-js-specifiers.test.ts`.
- Mock all network access: `fetch`, `@tavily/core`, SearXNG and Bing calls.
- Mock the filesystem or use temporary directories for note, outbox and ingest
  tests; never touch a real `KNOWLEDGE_DIR`.
- Exercise read-only mode by setting `PARADOCS_READONLY=1` or the pi-workflow
  unit variables through a test env object.
- Each test file covers one module or one behavior exhaustively.
