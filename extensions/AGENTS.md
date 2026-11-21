# Extensions

7 pi extensions that register deterministic tools and hooks. Auto-discovered
through `package.json` `"pi": { "extensions": ["./extensions"] }`.

| Extension | Tools | Purpose |
|-----------|-------|---------|
| `para-knowledge/` | 3 | Read-only BM25 search, tag listing, citation preview; `session_start` incremental reindex in the main process. |
| `para-evidence/` | 4 | Evidence packs, source verification and quote verification. |
| `para-outbox/` | 2 | `stage_para_docs` outbox writer and `ingest_para_outbox` fallback; `/para-ingest` and the implementation-complete ingest hook. |
| `para-recall/` | - | `before_agent_start` deterministic BM25 recall injection. |
| `web-search/` | 1 | Three-phase web search with a trust class per result. |
| `link-summarizer/` | 1 | `fetch_url` extraction with a built-in Tavily fallback. |
| `yaml-enforcer/` | 3 | Frontmatter validation, checking and standardization. |

## Read tools

`search_para_docs`, `list_para_tags`, `resolve_citation`, `gather_evidence`,
`get_evidence`, `verify_source`, `verify_quote`, `web_search`, `fetch_url`.

Read tools are safe in every phase and in read-only processes. They never
create, rebuild or write the knowledge base or `notes.db`.

## Write path

`stage_para_docs` validates block-structured notes and writes a batch under
`<cwd>/.pi/paradocs/outbox/<batchId>/`. Ingest is the only writer of
`KNOWLEDGE_DIR` files, `notes.db` and `ref.bib`; it runs on the
`workflow:implementation_complete` event, with `/para-ingest` and
`ingest_para_outbox` as fallbacks.

## Conventions

- Multiple-file extensions use an `index.ts` entry point under their directory.
- Every exported function has JSDoc; use `import type` for type-only imports.
- Tool files document parameters, return types and side effects.
- Shared deterministic helpers live in `common/`; no extension makes LLM calls
  or spawns pi subprocesses.
- Read-only mode is checked through `common/runtime.ts` before any index or
  knowledge-base write.
