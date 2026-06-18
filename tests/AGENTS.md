# Tests

Test files mirroring the source structure. Tests go next to the file they test with `.test.ts` suffix.

## Conventions

- File naming: `<module>.test.ts` (e.g., `slug.test.ts` for `common/slug.ts`).
- Use the test framework configured in `package.json`.
- Each test file covers one module exhaustively.
- Integration tests for extensions live under `tests/extensions/`.
