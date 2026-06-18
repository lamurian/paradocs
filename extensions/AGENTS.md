# Extensions

9 pi extensions that register custom tools. Auto-discovered by `pi install`.

| Extension           | Tools | Purpose                                    |
|---------------------|-------|--------------------------------------------|
| `para-knowledge/`   | 6     | SQLite FTS5 PARA doc engine + citation     |
| `web-search/`       | 1     | 3-phase web search (SearXNG→Tavily→Bing)  |
| `link-summarizer/`  | 2     | URL fetch + extract (CDP→HTTP→PDF→Tavily) |
| `batch-create/`     | 1     | Batch doc creation + auto-link             |
| `expand-bullets/`   | 1     | Bullet → paragraph via web research        |
| `roadmap-scratchpad/`| 3    | Learning pathway state tracker             |
| `scope-gate.ts`     | -     | File access protection (event interceptor) |
| `skill-gate.ts`     | -     | Workflow enforcement (event interceptor)   |
| `set-temperature.ts`| -     | Model temperature override (0.1)           |

## Conventions

- Multi-file extensions use `index.ts` entry point under their directory.
- Single-file extensions are `.ts` files directly in `extensions/`.
- Each tool file documents its parameters, return type, and side effects.
- Shared DB code imports from `common/`.
