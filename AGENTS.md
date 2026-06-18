# Paradocs — PARA Knowledge Management for pi

Standalone pi package that brings PARA (Projects, Areas, Resources, Archives) knowledge management to pi. Extracted from Cognoscere.

## Language & Conventions

- Use casual business English. Be concise.
- Every exported function must have JSDoc (purpose, params, return).
- Use `import type` for type-only imports. Prefer `interface` over `type`.
- Files ≤300 lines. Split into modules when exceeding.
- Kebab-case for files, camelCase for functions/vars, PascalCase for types/classes.

## Package Structure

This is a **pi extension package**. All source code lives in `extensions/` (tools),
`common/` (shared modules), and `types/` (type stubs). No `src/` directory needed as
the extension directories are the source. Each extension is auto-discovered by `pi install`.

| Directory     | Purpose                                              |
|---------------|------------------------------------------------------|
| `extensions/` | 9 pi extensions (auto-discovered by pi install)      |
| `skills/`     | 8 skills for workflow orchestration (SKILL.md)       |
| `common/`     | Shared modules (slug, tokenize, yaml)                |
| `types/`      | Type declarations (citation-js stubs, etc.)          |
| `tests/`      | Test files                                           |
| `docs/`       | ADRs, specs, plans                                   |

See per-directory AGENTS.md files for details on each area.
