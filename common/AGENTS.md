# Common — Shared Modules

Reusable utilities consumed by multiple extensions.

| Module      | Exports                                    | Used by                                    |
|-------------|--------------------------------------------|--------------------------------------------|
| `slug.ts`   | `slugify(title)` → kebab-case filename     | para-knowledge, batch-create, scratchpad   |
| `tokenize.ts`| `tokenize(text)`, `bm25TermScore()`       | para-knowledge (BM25), similarity check    |
| `yaml.ts`   | `formatFrontmatter()`, `yamlQuote()`       | para-knowledge, batch-create, scratchpad   |

## Conventions

- All exports are pure functions — no side effects, no global state.
- Each function has JSDoc with param/return types.
- No internal dependencies between modules (each stands alone).
