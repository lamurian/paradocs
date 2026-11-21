---
title: System Architecture
description: Paradocs — deterministic PARA knowledge capability for pi
date: 2026-06-19
---

# Overview

Paradocs is a standalone pi extension package that brings PARA
(Projects, Areas, Resources, Archives) knowledge management to pi. It is a
**deterministic capability layer**: pi-workflow owns subagent orchestration, the
agent does all reasoning, and Paradocs makes no LLM calls and spawns no pi
subprocesses.

Files are the source of truth. `notes.db` is a rebuildable SQLite/FTS5 index.
Ingest is the only writer of knowledge files, the index and `ref.bib`.

# Design Principles

- **No `src/` directory**: extensions in `extensions/` are auto-discovered by
  `pi install`; shared code lives in `common/`, type stubs in `types/`.
- **Deterministic behavior**: search, freshness, wrapping, recall and
  verification are pure or file/index based. No model calls.
- **Read tools are always safe**: they never create, rebuild or write the
  index or knowledge base.
- **One writer**: ingest owns `KNOWLEDGE_DIR`, `notes.db` and `ref.bib`.
- **Files over indexes**: every index value can be rebuilt from markdown and
  `ref.bib`.
- **Configuration via environment and `paradocs.json`**: env uses a three-layer
  cascade; note, recall and freshness behavior live in `paradocs.json`.
- **Quality-first**: TypeScript strict, ESLint (complexity ≤15), 300-line file
  limit, vitest with coverage thresholds.

# System Architecture

## Configuration Layer (`common/env.ts`)

Three-layer dotenv cascade (defaults → `~/.pi/agent/.env` → `<cwd>/.pi/.env`)
with typed getters. `getKnowledgeConfig()` returns `KNOWLEDGE_DIR` and
`KNOWLEDGE_DB`. Tilde expansion is supported for path-like values.

`common/config.ts` loads `<KNOWLEDGE_DIR>/paradocs.json`, deep-merges each
section over built-in defaults, and reports invalid values as issues.

## Extensions (7)

| Extension | Type | Purpose |
|---|---|---|
| `para-knowledge/` | 3 read tools + `session_start` reindex | BM25 search, tag listing, citation preview; incremental reindex in the main process. |
| `para-evidence/` | 4 tools | Evidence packs, source verification, quote verification. |
| `para-outbox/` | 2 tools + command + event hook | `stage_para_docs`, `ingest_para_outbox`, `/para-ingest`, automatic ingest. |
| `para-recall/` | `before_agent_start` hook | Deterministic BM25 recall injection. |
| `web-search/` | 1 tool | Three-phase search with trust classes. |
| `link-summarizer/` | 1 tool | URL extraction with built-in Tavily fallback. |
| `yaml-enforcer/` | 3 tools | Frontmatter validation, checking and standardization. |

## Read Tools

Read tools are safe in every phase and in read-only unit processes:

- `search_para_docs` — BM25 search with a freshness block per hit.
- `list_para_tags` — unique tags from the existing index.
- `resolve_citation` — citation preview only; never writes `ref.bib` or
  `notes.db`.
- `web_search` — SearXNG → Tavily → Bing RSS, with a trust class per result.
- `fetch_url` — PDF → headless browser → HTTP → Tavily extract.
- `gather_evidence` — KB first, web fallback, fetched sources stored in a pack.
- `get_evidence` — read a stored evidence pack by id.
- `verify_source` — DOI, reachability, Crossref and Wayback checks.
- `verify_quote` — exact or fuzzy quote matching against a source.

The index is opened read-only. A missing `notes.db` returns guidance rather than
creating one.

## Write Path: Stage, Outbox and Ingest

1. **Stage** — `stage_para_docs` accepts block-structured notes (summary
   paragraphs, key points, tags, citations). It renders and validates every note
   first; any error aborts the batch with no files written.
2. **Outbox** — a successful batch is written to
   `<cwd>/.pi/paradocs/outbox/<batchId>/` containing `notes/<slug>.md`,
   `citations.json` and `manifest.json`. Updates record the current target hash
   as `baseHash`.
3. **Ingest** — `common/ingest.ts` processes batch directories in name order,
   commits staged citations, writes and indexes notes, appends BM25 related-note
   links, and moves processed batches to `outbox/.ingested/`.

Ingest is the only writer of `KNOWLEDGE_DIR` files, `notes.db` and `ref.bib`.
It makes one knowledge-base git commit per run when anything changed.

Ingest runs automatically on the `pi.events` channel
`workflow:implementation_complete` with payload `{ cwd?: string }`. The
`/para-ingest` command and `ingest_para_outbox` tool are fallbacks.

An update whose recorded `baseHash` differs from the current file is never
overwritten. It is parked under `.pi/paradocs/outbox/.conflicts/<batchId>/` and
reported as a conflict.

## Hooks

### `before_agent_start` recall (`para-recall`)

A deterministic BM25 lookup on the prompt injects a hidden custom message. It
only reads an existing `notes.db`. No injection occurs when the index is missing,
the prompt is skipped, or the lookup exceeds `recall.timeoutMs`. Slash commands
are skipped except `/discuss`; `recall.skipPatterns` adds regular expressions.

### `session_start` incremental reindex (`para-knowledge`)

The main process refreshes changed notes in the index. The hook is skipped in
read-only processes, which must never create or rebuild `notes.db`.

## Read-Only Processes

A process is read-only when any of the following is set:

- `PARADOCS_READONLY=1`
- `PI_UNIT_FILE` (pi-workflow unit)
- `PI_CONTRACT_GUARD_FILE` (contract guard)

Read-only processes never create, rebuild or write `notes.db` or
`KNOWLEDGE_DIR`, and ingest refuses to run. Read tools still work, and
`stage_para_docs` still writes to the cwd outbox so the main process can ingest
the batch.

## Note Rendering (`common/note-render.ts`)

Notes are rendered block by block so output and line accounting are
deterministic:

- Expanded frontmatter: `title`, `description`, `author: pi`, `editor: lam`,
  `date`, `tags` as a block list, optional `reviewed` and `review_interval`.
- Fixed headings: `## Summary`, `## Key Points`, then `## Sources` generated
  from cited `@citekeys`. Ingest adds `## Relevant notes` with up to
  `note.maxLinks` BM25 links.
- Summary and Key Points are hard-wrapped at `note.wrapWidth` (80) following
  markdownlint MD013.
- Content lines = wrapped Summary + Key Points lines and must be ≤
  `note.maxContentLines` (60).
- Table rows are never wrapped; each costs `ceil(length / 80)` lines.
- Frontmatter, headings, blank lines, Sources and Relevant notes link lines are
  exempt from both the cap and the width rule.
- Long unbreakable tokens such as URLs sit on their own line.

## Freshness (`common/freshness.ts`)

Freshness is deterministic from index metadata and dates:

- Window precedence: positive `review_interval`, then the smallest numeric
  window among matching `freshness.tagWindows`, then
  `freshness.defaultWindowDays`. A `null` tag window means never stale.
- Age basis precedence: `reviewed`, newest cited source `date`, latest citation
  `verified`, then the note modification date.
- Status: `aging` after 75% of the window, `stale` after the window, `unknown`
  when no basis date exists.
- `ref.bib` entries carry `date`, `urldate` and `verified`; note frontmatter may
  carry `reviewed` (ISO date) and `review_interval` (days).

## `paradocs.json`

Stored at `KNOWLEDGE_DIR/paradocs.json`. Missing sections use these defaults:

| Key | Default |
|---|---|
| `freshness.defaultWindowDays` | `365` |
| `freshness.tagWindows` | `{}` (tag → days, or `null` for never stale) |
| `recall.maxChars` | `2000` |
| `recall.maxTerms` | `12` |
| `recall.timeoutMs` | `150` |
| `recall.maxHits` | `5` |
| `recall.minMatchedTerms` | `2` |
| `recall.skipPatterns` | `[]` |
| `note.maxContentLines` | `60` |
| `note.wrapWidth` | `80` |
| `note.maxLinks` | `5` |

# Project Outbox and Git

Projects that use Paradocs should add `.pi/paradocs/` to `.gitignore` so staged
batches, conflicts and evidence packs stay out of the project repository. This
repository already ignores `.pi/paradocs/`.

# Implementation Status

All documents are at `implemented` status.

## ADRs (10/10)

- [x] ADR 001
- [x] ADR 002
- [x] ADR 003
- [x] ADR 004
- [x] ADR 005
- [x] ADR 006
- [x] ADR 007
- [x] ADR 008
- [x] ADR 009
- [x] ADR 010

## Specs (26/26)

- [x] Spec 001
- [x] Spec 002
- [x] Spec 003
- [x] Spec 004
- [x] Spec 005
- [x] Spec 006
- [x] Spec 007
- [x] Spec 008
- [x] Spec 009
- [x] Spec 010
- [x] Spec 011
- [x] Spec 012
- [x] Spec 013
- [x] Spec 014
- [x] Spec 015
- [x] Spec 016
- [x] Spec 017
- [x] Spec 018
- [x] Spec 019
- [x] Spec 020
- [x] Spec 021
- [x] Spec 022
- [x] Spec 023
- [x] Spec 024
- [x] Spec 025
- [x] Spec 026

## Cross-Reference Format

All PARA cross-references use standard Markdown link syntax:

```markdown
[Display Title](path-from-knowledge-dir.md)
```

- **Title resolution**: queried from the SQLite `files` table via
  `SELECT title FROM files WHERE path = ?`, falling back to the filename stem.
- **Path convention**: full relative path from the knowledge base root,
  including the PARA area prefix (for example `Resources/note-title.md`).
- **Scope**: applies to all "Relevant notes" sections and link output.

## Quick reference

See [README.md](README.md) for usage, [docs/ADR/](docs/ADR/) for architecture
decisions, and [docs/specs/](docs/specs/) for detailed specifications.
