# Paradocs

**PARA Knowledge Management for [pi](https://github.com/earendil-works/pi-coding-agent)**

> 7 extensions · deterministic read tools · staged writes · SQLite FTS5 search · BM25 recall · freshness-aware notes

Paradocs brings [PARA](https://fortelabs.com/blog/para/) knowledge management
(Projects, Areas, Resources, Archives) to pi as a **deterministic capability
layer**. pi-workflow owns all subagent orchestration and the agent (main session
or workflow unit) does all reasoning. Paradocs makes no LLM calls and spawns no
pi subprocesses.

It provides read tools that are safe in every phase, a reviewable staging
outbox, and a single ingest writer that owns the knowledge base. Files remain
the source of truth; SQLite is a rebuildable index.

---

## Features

| Area | What it does |
|------|--------------|
| **PARA search** | BM25 search over Projects, Areas and Resources with a freshness block per hit. |
| **Tag listing** | Lists every tag already present so new notes reuse existing vocabulary. |
| **Web research** | Three-phase search (SearXNG → Tavily → Bing RSS) with a trust class per result. |
| **URL fetching** | Markdown extraction via PDF, headless browser, HTTP, then Tavily extract. |
| **Evidence** | Gathers evidence packs, reads them back, and verifies sources and quotes deterministically. |
| **Citation preview** | Resolves DOIs and URLs to Pandoc citekeys without writing `ref.bib` or `notes.db`. |
| **Staged writes** | `stage_para_docs` validates block-structured notes and writes an outbox batch inside the cwd. |
| **Single ingest writer** | Ingest applies the outbox to the knowledge base, index and `ref.bib` with one KB git commit per run. |
| **Deterministic recall** | A `before_agent_start` hook injects a hidden BM25 recall block when it finishes inside the timeout. |
| **Incremental reindex** | A `session_start` hook refreshes changed notes in the main process only. |
| **Freshness** | Review metadata, source dates and verification dates drive fresh/aging/stale verdicts. |
| **YAML enforcement** | Validates, checks and repairs note frontmatter. |

---

## Quick Start

### Prerequisites

- **pi** v0.78+ (`@earendil-works/pi-coding-agent`)
- **Node.js** 20+
- A PARA-organized directory of markdown files (see the
  [PARA method](https://fortelabs.com/blog/para/))

Optional:
- **Obscura** headless browser — JS-rendered page fetching
- **SearXNG** instance — self-hosted web search
- **Tavily API key** — web search and extraction fallback
- **pdftotext** (poppler-utils) — PDF extraction

### Install

```bash
pi install git+https://github.com/your-org/paradocs.git
# or during development
pi install /path/to/paradocs
```

Each folder under `extensions/` is auto-discovered through the package manifest
(`"pi": { "extensions": ["./extensions"] }`). No build step is required.

### Configure

Set environment variables in `~/.pi/agent/.env` or your project's `.pi/.env`:

```env
KNOWLEDGE_DIR=~/data/knowledge
KNOWLEDGE_DB=notes.db
SEARXNG_PORT=8888
TAVILY_KEY=tvly-...
```

Paradocs also reads `KNOWLEDGE_DIR/paradocs.json`; see
[Configuration](#configuration).

### Gitignore the outbox

Projects that use Paradocs should add the staging outbox to `.gitignore`:

```gitignore
.pi/paradocs/
```

That keeps batches, conflicts and evidence packs out of the project repository.
This repository already ignores `.pi/paradocs/`; apply the same line to every
project that stages notes.

---

## Tools

### Read tools

Read tools are safe in every phase, including read-only unit processes. They
never create, rebuild or write the index or knowledge base.

| Tool | Purpose |
|------|---------|
| `search_para_docs` | BM25 search with optional tag filters; each hit carries a freshness block. |
| `list_para_tags` | List unique tags already indexed. |
| `resolve_citation` | Preview a DOI/URL citation, citekey and BibTeX; never writes. |
| `web_search` | Three-phase web search with a trust class per result. |
| `fetch_url` | Fetch a URL as Markdown with a built-in Tavily fallback. |
| `gather_evidence` | Gather KB plus web sources into an evidence pack. |
| `get_evidence` | Read a stored evidence pack by id. |
| `verify_source` | Check DOI, reachability, Crossref and Wayback metadata. |
| `verify_quote` | Check a quote against an evidence source or URL. |

### Write path

| Tool | Purpose |
|------|---------|
| `stage_para_docs` | Validate block-structured notes and write them to `.pi/paradocs/outbox/<batchId>/`. |
| `ingest_para_outbox` | Manually ingest the outbox (fallback; ingest normally runs automatically). |

`stage_para_docs` is the only write tool available to read-only processes. It
never touches `KNOWLEDGE_DIR`, `notes.db` or `ref.bib`.

### Frontmatter tools

| Tool | Purpose |
|------|---------|
| `validate_frontmatter` | Scan and optionally repair frontmatter issues. |
| `check_frontmatter` | Report frontmatter problems without writing. |
| `standardize_frontmatter` | Normalize frontmatter to the standard field order. |

---

## Stage, outbox and ingest

1. **Stage.** Call `stage_para_docs` with block input: summary paragraphs,
   key points and citations. One invalid note aborts the whole batch before any
   file is written.
2. **Outbox.** The batch lives under `<cwd>/.pi/paradocs/outbox/<batchId>/` with
   `notes/`, `citations.json` and `manifest.json`. Updates record the current
   file hash as `baseHash`.
3. **Ingest.** Ingest is the only writer of `KNOWLEDGE_DIR` files, `notes.db`
   and `ref.bib`.

Ingest runs automatically when pi-workflow publishes the
`workflow:implementation_complete` event on the `pi.events` channel with payload
`{ cwd?: string }`. It also has two fallbacks:

- the `/para-ingest` command;
- the `ingest_para_outbox` tool.

One ingest run makes one knowledge-base git commit when anything changed. An
update whose recorded `baseHash` differs from the current file is not written
over: it is parked under `.pi/paradocs/outbox/.conflicts/<batchId>/`.

---

## Hooks

| Hook | Behavior |
|------|----------|
| `before_agent_start` | Runs a deterministic BM25 lookup on the prompt and injects a hidden custom message. The lookup only reads an existing `notes.db`; nothing is injected when the index is missing or the run exceeds `recall.timeoutMs`. |
| `session_start` | Runs an incremental reindex of changed notes. Main process only; skipped in read-only processes. |

Recall skips slash commands (except `/discuss`) and any prompt matching
`recall.skipPatterns`.

---

## Read-only mode

A process is read-only when any of these is set:

- `PARADOCS_READONLY=1`
- `PI_UNIT_FILE` (pi-workflow unit)
- `PI_CONTRACT_GUARD_FILE` (contract guard)

A read-only process never creates, rebuilds or writes `notes.db` or
`KNOWLEDGE_DIR`, and refuses to ingest. Read tools still work, and
`stage_para_docs` still writes to the cwd outbox so the batch can be ingested by
the main process later.

---

## Configuration

Paradocs reads `KNOWLEDGE_DIR/paradocs.json`. Missing sections use the defaults
below; invalid values fall back to the default for that value.

```json
{
  "freshness": {
    "defaultWindowDays": 365,
    "tagWindows": { "security": 90, "history": null }
  },
  "recall": {
    "maxChars": 2000,
    "maxTerms": 12,
    "timeoutMs": 150,
    "maxHits": 5,
    "minMatchedTerms": 2,
    "skipPatterns": []
  },
  "note": {
    "maxContentLines": 60,
    "wrapWidth": 80,
    "maxLinks": 5
  }
}
```

| Key | Default | Meaning |
|-----|---------|---------|
| `freshness.defaultWindowDays` | `365` | Freshness window when no tag or review interval applies. |
| `freshness.tagWindows` | `{}` | Tag → window in days. Use `null` so notes with that tag never go stale. |
| `recall.maxChars` | `2000` | Maximum size of the injected recall block. |
| `recall.maxTerms` | `12` | Maximum prompt terms used for the BM25 lookup. |
| `recall.timeoutMs` | `150` | Discard the injection when the lookup takes longer. |
| `recall.maxHits` | `5` | Maximum notes injected. |
| `recall.minMatchedTerms` | `2` | Minimum matched terms before a note qualifies. |
| `recall.skipPatterns` | `[]` | Regular expressions for prompts that skip recall. |
| `note.maxContentLines` | `60` | Maximum wrapped Summary + Key Points content lines. |
| `note.wrapWidth` | `80` | Hard-wrap width for Summary and Key Points. |
| `note.maxLinks` | `5` | Maximum BM25 related-note links added at ingest. |

Environment variables use the three-layer cascade (hardcoded defaults →
`~/.pi/agent/.env` → `<cwd>/.pi/.env`). Path-like values support `~` expansion.

| Variable | Default | Description |
|----------|---------|-------------|
| `KNOWLEDGE_DIR` | `~/data/personal/Documents/Cognoscere` | PARA markdown root. |
| `KNOWLEDGE_DB` | `notes.db` | SQLite index filename relative to `KNOWLEDGE_DIR`. |
| `SEARXNG_PORT` | `8888` | SearXNG port. |
| `TAVILY_KEY` | — | Tavily API key for search and extract. |
| `GITHUB_TOKEN` | — | GitHub API token. |

---

## Note rendering

Notes are rendered block by block:

1. Expanded frontmatter: `title`, `description`, `author: pi`, `editor: lam`,
   `date`, `tags` as a block list, and optional `reviewed` and
   `review_interval`.
2. Fixed headings: `## Summary`, `## Key Points`, then `## Sources` generated
   from cited `@citekeys`. Ingest adds `## Relevant notes` with up to
   `note.maxLinks` BM25 links.
3. Summary and Key Points are hard-wrapped at 80 columns (markdownlint MD013).
4. Content lines = wrapped Summary lines + Key Points lines and must be at most
   60.
5. Table rows are never wrapped; each costs `ceil(length / 80)` lines.
6. Frontmatter, headings, blank lines, Sources and Relevant notes link lines are
   exempt from the line cap and the width rule.
7. Long unbreakable tokens such as URLs sit on their own line.

---

## Freshness

Each note gets a freshness verdict: `fresh`, `aging`, `stale` or `unknown`.

- The window comes from `review_interval`, then the smallest numeric window
  among the note's `freshness.tagWindows`, then `defaultWindowDays`. A `null`
  tag window means the note never goes stale.
- Age is measured from the first available basis: `reviewed`, then the newest
  cited source publication date, then the latest citation verification, then
  the note's modification date.
- A note becomes `aging` after 75% of its window and `stale` after the window.
- `ref.bib` entries carry `date`, `urldate` and `verified` fields; note
  frontmatter may carry `reviewed` (ISO date) and `review_interval` (days).

---

## Extensions

| Extension | Tools | Description |
|-----------|-------|-------------|
| **para-knowledge** | `search_para_docs`, `list_para_tags`, `resolve_citation` | Read-only PARA search, tags and citation previews. |
| **para-evidence** | `gather_evidence`, `get_evidence`, `verify_source`, `verify_quote` | Evidence packs, source verification and quote checks. |
| **para-outbox** | `stage_para_docs`, `ingest_para_outbox`, `/para-ingest` | Staging outbox and the single ingest writer. |
| **para-recall** | (hook) | Deterministic `before_agent_start` BM25 recall. |
| **web-search** | `web_search` | Three-phase search with trust classes. |
| **link-summarizer** | `fetch_url` | URL extraction with Tavily fallback. |
| **yaml-enforcer** | `validate_frontmatter`, `check_frontmatter`, `standardize_frontmatter` | Frontmatter validation and repair. |

---

## Development

```bash
npm run lint          # ESLint
npm run format        # Prettier
npm run typecheck     # tsc --noEmit
npm run check:lines   # File length check (≤300 lines)
npm run test          # Vitest with coverage
npm run precommit     # Full pre-commit pipeline
```

| Gate | Threshold |
|------|-----------|
| File length | ≤300 lines |
| ESLint complexity | ≤15 |
| Test coverage | 70% statements, 60% branches, 70% functions, 70% lines |
| TypeScript | strict mode |

### Project structure

```
paradocs/
├── extensions/           # 7 pi extensions (auto-discovered)
│   ├── para-knowledge/   # read tools: search, tags, citation preview
│   ├── para-evidence/    # evidence, source and quote verification
│   ├── para-outbox/      # stage, ingest, /para-ingest
│   ├── para-recall/      # before_agent_start recall hook
│   ├── web-search/       # three-phase web search
│   ├── link-summarizer/  # fetch_url
│   └── yaml-enforcer/    # frontmatter validation and repair
├── common/               # shared deterministic modules
├── types/                # type stubs
├── tests/                # Vitest test files
├── docs/                 # ADRs, specs, plans
├── package.json
└── ARCHITECTURE.md
```

---

## Design decisions

- **Deterministic capability layer** — no LLM calls and no pi subprocesses.
- **Read tools everywhere** — safe in every phase and in read-only processes.
- **One writer** — ingest is the only writer of knowledge files and indexes.
- **Files are the source of truth** — `notes.db` is a rebuildable index.
- **Outbox inside the project** — `<cwd>/.pi/paradocs/outbox/` keeps staging
  reviewable and easy to gitignore.
- **Conflicts over overwrites** — changed base hashes are parked, never
  clobbered.

---

## License

MIT — see [LICENSE](LICENSE) for details.
