# Common — Shared Modules

Deterministic modules shared by extensions and ingest. No module makes LLM calls
or spawns pi subprocesses.

## Configuration and runtime

| Module | Exports | Purpose |
|--------|---------|---------|
| `env.ts` | `configureEnv`, `getKnowledgeConfig`, `getSearxngConfig`, `getObscuraConfig`, `getApiKeys`, `expandTilde` | Three-layer dotenv cascade and typed env getters. |
| `config.ts` | `loadParadocsConfig`, `DEFAULT_PARADOCS_CONFIG` | Load and validate `KNOWLEDGE_DIR/paradocs.json` over defaults. |
| `runtime.ts` | `isReadOnlyProcess` | Detect `PARADOCS_READONLY=1`, `PI_UNIT_FILE` and `PI_CONTRACT_GUARD_FILE`. |

## Text and rendering

| Module | Exports | Purpose |
|--------|---------|---------|
| `slug.ts` | `slugify` | Kebab-case filename from a title. |
| `tokenize.ts` | `tokenize`, `bm25TermScore` | BM25 tokenizer and scoring. |
| `yaml.ts` | `formatFrontmatter`, `yamlQuote` | Standard frontmatter field order and safe quoting. |
| `text-wrap.ts` | `wrapText` | Greedy word wrap counting prefixes against the width. |
| `note-render.ts` | `renderNote` | Block-by-block note rendering and content-line accounting. |
| `citekeys.ts` | `extractCitekeys` | Pandoc `@key` extraction. |

## Index, freshness and recall

| Module | Exports | Purpose |
|--------|---------|---------|
| `notesDb.ts` | `ensureNotesDb`, `openNotesDbReadOnly`, `getNotesDbPath`, `missingNotesDbMessage` | Open or rebuild `notes.db`; read-only opens never create it. |
| `freshness.ts` | `computeFreshness`, `loadFreshness`, `resolveWindowDays`, `parseDate` | Deterministic fresh/aging/stale verdicts. |
| `recall-query.ts` | `extractRecallTerms`, `buildIdfMap` | Prompt term selection and IDF lookup. |
| `recall.ts` | `runRecall`, `shouldSkipRecall` | BM25 recall block for `before_agent_start`. |

## Outbox and ingest

| Module | Exports | Purpose |
|--------|---------|---------|
| `outbox.ts` | `writeOutboxBatch`, `sha256File` | Write batches under `<cwd>/.pi/paradocs/outbox/`. |
| `stage-validate.ts` | `validateStagedNote`, `findDuplicateTitle`, `loadKnownCitekeys` | Validate staged notes before writing. |
| `ingest.ts` | `ingestOutbox` | Apply outbox batches, park conflicts and move processed batches. |
| `ingest-notes.ts` | `indexNoteFile`, `buildDocIndex` | Re-read and index a written note. |
| `ingest-finalize.ts` | `commitIngestCitations`, `linkIngestedNote`, `commitIngestRun`, `formatIngestReport`, `readIngestMaxLinks` | Order citations, related links, one KB commit and the report. |
| `autoLink.ts` | `findRelated`, `appendLinks`, `autoLink` | BM25 related-note links under `## Relevant notes`. |
| `gitCommit.ts` | `commitKnowledgeBase` | One knowledge-base git commit helper. |

## Citations and evidence

| Module | Exports | Purpose |
|--------|---------|---------|
| `citation.ts` | `previewCitation` | DOI/URL preview with citekey and `date`/`urldate`; never writes. |
| `citation-commit.ts` | `commitCitations`, `injectBibtexField` | Commit staged citations to `ref.bib` and `notes.db` during ingest. |
| `citation-validation.ts` | `validateCitations`, `loadRefBibCitekeys` | Validate citekeys against `ref.bib`. |
| `evidence-cache.ts` | `saveEvidencePack`, `loadEvidencePack` | Persist and read evidence packs in the cwd cache. |
| `gather-evidence.ts` | `gatherEvidence` | KB-first, web-fallback evidence gathering. |
| `verify-source.ts` | `verifySource` | DOI, reachability, Crossref and Wayback checks. |
| `verify-quote.ts` | `verifyQuote` | Exact/fuzzy quote matching. |

## Network

| Module | Exports | Purpose |
|--------|---------|---------|
| `fetchUrl.ts` | `fetchUrlAsText`, `fetchUrlWithTimeout` | PDF → headless browser → HTTP → Tavily extraction. |
| `webSearch.ts` | `searchWeb`, `formatResults`, `sinceToTimeRange` | SearXNG → Tavily → Bing RSS orchestration. |
| `trust.ts` | `classifyTrust` | Deterministic source trust classification. |
| `url.ts` | `canonicalizeUrl`, `registrableDomain` | URL canonicalization and domain extraction. |

## Conventions

- Exports are deterministic and side effects are documented.
- Each function has JSDoc with parameters and return value.
- Use `import type` for type-only imports.
- Configuration comes from `common/env.ts` and `common/config.ts`, not from
  ad-hoc environment reads.
