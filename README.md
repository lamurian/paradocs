# Paradocs

**PARA Knowledge Management for [pi](https://github.com/earendil-works/pi-coding-agent)**

> 7 extensions · 14 tools · 7 skills · SQLite FTS5 search · 3-tier web search · semantic auto-linking · YAML enforcer

Paradocs brings [PARA](https://fortelabs.com/blog/para/) knowledge management (Projects, Areas, Resources, Archives) directly into your pi coding agent. It's a standalone pi extension package designed for Zettelkasten-style atomic note-taking, BM25-powered search, citation management, web research, and workflow enforcement.

Instead of managing a knowledge base with a separate app, Paradocs lets you query, create, update, and interlink notes through natural conversation with pi. The agent searches your PARA-organized markdown files first, augments with web research when needed, and keeps everything consistently formatted and cross-linked.

---

## Features

| Area | What it does |
|------|--------------|
| **PARA search** | Full-text BM25 search over Projects, Areas, Resources, Archives directories. Tag-boosted, ranked results. |
| **Document creation** | Single and batch creation of atomic notes with auto-generated frontmatter, slugified filenames, and dedup. |
| **Web research** | Three-tier search pipeline: SearXNG → Tavily → Bing RSS. Academic, filtered, or general tiers with automatic fallback. |
| **Link summarization** | Fetches URLs via headless browser (CDP), HTTP, PDF extraction, or Tavily extract. Handles SPAs and JS-rendered pages. |
| **Citation management** | Resolve DOIs and URLs to Pandoc-style citekeys (`@authorYYYY`) via Citation.js. Dedup built in. |
| **Semantic auto-linking** | LLM-powered `[[wikilink]]` generation that goes beyond keyword matching to find conceptual connections. |
| **YAML frontmatter enforcer** | Validates and auto-repairs frontmatter across your entire PARA directory. |
| **Workflow enforcement** | Skill-gate interceptor that reminds the agent to search before creating — preventing duplicate notes. |
| **Bullet expansion** | Expands outline bullets into fully researched paragraphs with inline citations. |

---

## Quick Start

### Prerequisites

- **pi** v0.78+ (`@earendil-works/pi-coding-agent`)
- **Node.js** 20+
- A PARA-organized directory of markdown files (see [PARA method](https://fortelabs.com/blog/para/))

Optional but recommended:
- **Obscura** headless browser (Docker) — for JS-rendered page fetching
- **SearXNG** instance — for self-hosted web search
- **Tavily API key** — web search fallback
- **pdftotext** (poppler-utils) — PDF content extraction

### Install

```bash
# Install directly from a git repository
pi install git+https://github.com/your-org/paradocs.git

# Or from a local path during development
pi install /path/to/paradocs
```

This installs the package and its dependencies. Paradocs uses flat extension
directories — each folder under `extensions/` is auto-discovered on install.
No build step or manual tool registration needed.

### Configure

Set environment variables in `~/.pi/agent/.env` or your project's `.pi/.env`:

```env
# Path to your PARA markdown collection (required)
KNOWLEDGE_DIR=~/data/knowledge

# Search engine endpoint (optional, has defaults)
SEARXNG_PORT=8888

# API keys (optional, fallback tiers)
TAVILY_API_KEY=tvly-...
```

See [Configuration](#configuration) for all available options.

---

## Usage

Paradocs is designed to be used through pi's conversational interface. Here's how the tools and skills work together.

### Searching your knowledge base

```text
You: What do I have on dopamine and motivation?

pi: [runs search_para_docs("dopamine motivation")]
    → Found 3 matching documents:
      • Resources/dopamine-and-motivation.md (score: 12.4)
      • Resources/motivation-theories.md (score: 8.2)
      • Projects/reward-system-design.md (score: 5.1)
```

The BM25 search engine ranks results by term frequency, inverse document frequency, and tag overlap. Documents with matching tags are boosted.

### Creating a new note

```text
You: Create a quick note about the Yerkes-Dodson law.

pi: [runs create_para_doc()]
    → Created Resources/yerkes-dodson-law.md with frontmatter:
      ---
      title: Yerkes-Dodson Law
      tags: [reference, psychology, performance]
      area: Resources
      description: Relationship between arousal and performance
      date: 2026-06-19
      author: pi
      editor: lam
      ---
```

### Batch creation with auto-linking

```text
You: Save these three research findings about habit formation.

pi: [runs batch_create_para_docs({
      docs: [...],
      autoLink: true
    })]
    → Created 3 documents
    → Auto-linked 12 related notes via [[wikilinks]]
```

### Web research workflow

```text
You: Find recent papers on transformer attention mechanisms.

pi: [runs web_search("transformer attention mechanisms", tier=1)]
    → SearXNG academic tier → 8 results
      • "Attention Is All You Need" (arxiv.org)
      • "Efficient Transformers: A Survey" (acm.org)
      • ...
```

The search cascades through three tiers automatically — SearXNG → Tavily → Bing RSS — when results are thin.

### Summarizing a link

```text
You: Summarize this article for me: https://example.com/deep-learning

pi: 1. Checks for existing summary (dedup) — none found
    2. Fetches via Obscura headless browser → extracts content
    3. Summarizes key points
    4. Creates document with citations
    → Created Resources/understanding-deep-learning.md
```

### Auto-linking a note

After creating or updating a note, run:

```text
You: /skill:auto-link

pi: Extracts key concepts from the note
    → Searches related notes per concept
    → Evaluates semantic connections via LLM
    → Appends top 5 [[wikilinks]] to the note
    → "Auto-linked 'Dopamine and Motivation' to:
       • incentive-salience — same neural pathway
       • reward-prediction-error — complementary mechanism
       • effort-cost-computation — apply to decision-making"
```

### Checking frontmatter health

```text
You: Check all my PARA files for frontmatter issues.

pi: [runs check_frontmatter()]
    → Scanned 47 files
    → Found 3 issues:
      • Resources/old-note.md — missing "tags" field
      • Projects/draft.md — invalid date format
      • Areas/goals.md — missing "description"

You: Fix them.

pi: [runs standardize_frontmatter()]
    → Repaired 3 files
```

---

## Configuration

Paradocs uses a three-layer environment cascade (lowest to highest priority):

1. **Hardcoded defaults** (built into `common/env.ts`)
2. **Global config** — `~/.pi/agent/.env`
3. **Project config** — `<cwd>/.pi/.env`

### Available variables

| Variable | Default | Description |
|----------|---------|-------------|
| `KNOWLEDGE_DIR` | — | Path to your PARA markdown collection (required) |
| `KNOWLEDGE_DB` | `paradocs.db` | SQLite database filename (relative to KNOWLEDGE_DIR) |
| `SEARXNG_PORT` | `8888` | SearXNG instance port |
| `TAVILY_API_KEY` | — | API key for Tavily web search |
| `OBSCURA_WS_URL` | — | WebSocket URL for headless browser |
| `BING_API_KEY` | — | API key for Bing RSS search |

All path-like values support tilde expansion (`~/...`).

### Environment setup

```bash
# Create global config
echo "KNOWLEDGE_DIR=~/data/personal/knowledge" >> ~/.pi/agent/.env

# Or project-local config
echo "TAVILY_API_KEY=tvly-..." >> .pi/.env
```

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                        pi agent                         │
│  ┌──────┐  ┌──────────┐  ┌───────┐  ┌───────────────┐   │
│  │skill-│  │knowledge │  │web-   │  │summarize-link │   │
│  │ gate │  │  skill   │  │search │  │    skill      │   │
│  └──┬───┘  └────┬─────┘  └───┬───┘  └──────┬────────┘   │
│     │           │            │             │            │
│     ▼           ▼            ▼             ▼            │
│  ┌──────────────────────────────────────────────────┐   │
│  │             7 Extensions · 14 Tools              │   │
│  │  ┌─────────────┐ ┌──────────┐ ┌───────────────┐  │   │
│  │  │para-        │ │web-search│ │link-summarizer│  │   │
│  │  │knowledge    │ │(1 tool)  │ │(2 tools)      │  │   │
│  │  │(6 tools)    │ └──────────┘ └───────────────┘  │   │
│  │  └─────────────┘                                 │   │
│  │  ┌──────────────┐ ┌─────────┐ ┌────────────────┐ │   │ 
│  │  │yaml-enforcer │ │batch-   │ │expand-bullets  │ │   │
│  │  │(3 tools)     │ │create   │ │(1 tool)        │ │   │
│  │  └──────────────┘ │(1 tool) │ └────────────────┘ │   │
│  │                   └─────────┘                    │   │
│  └──────────────────────────────────────────────────┘   │
│                           │                             │
│                           ▼                             │
│  ┌──────────────────────────────────────────────────┐   │
│  │              Shared Modules (common/)            │   │
│  │  slug.ts · tokenize.ts · yaml.ts · env.ts        │   │
│  └──────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘

### Data flow

1. **User asks a question** → skill-gate interceptor checks that a PARA search (`search_para_docs`) was performed this turn
2. **BM25 search** queries the SQLite FTS5 index — returns ranked documents with tag boosts
3. **If insufficient** → `web_search` via SearXNG → Tavily → Bing RSS fallback chain
4. **Agent creates atomic notes** → `create_para_doc` or `batch_create_para_docs` with auto-generated frontmatter
5. **YAML enforcer** auto-repairs frontmatter after creation/update
6. **Auto-link** runs LLM-powered `[[wikilink]]` semantic linking to related notes

### Search pipeline (BM25)

```
Query → tokenize (stop word removal)
       → batch lookup in SQLite term_index (one query via IN-list)
       → compute Okapi BM25 score per candidate doc
       → add tag-match boost (TAG_BOOST: 1.5)
       → sort by combined score → top MAX_RESULTS: 25
```

Only 3 database round-trips regardless of query length.

---

## Extensions

| Extension | Tools | Description |
|-----------|-------|-------------|
| **para-knowledge** | `search_para_docs`, `create_para_doc`, `update_para_doc`, `resolve_citation`, `list_para_tags`, `find_existing_summary` | Core PARA engine: SQLite FTS5 search, CRUD, citation management, tag listing, dedup |
| **web-search** | `web_search` | Three-phase search (SearXNG → Tavily → Bing RSS) with academic/filtered/general tiers |
| **link-summarizer** | `fetch_url`, `summarize_link` | URL content extraction via CDP browser → HTTP → PDF → Tavily extract |
| **batch-create** | `batch_create_para_docs` | Batch document creation with auto-linking |
| **expand-bullets** | `expand_bullets` | Bullet point → paragraph expansion with web research |
| **yaml-enforcer** | `validate_frontmatter`, `check_frontmatter`, `standardize_frontmatter` | Frontmatter validation and auto-repair |
| **skill-gate** | (event interceptor) | Enforces search-first workflow; warns if agent creates without prior search |

## Skills

Skills are markdown workflow definitions that orchestrate the tools above.

| Skill | Purpose |
|-------|---------|
| **knowledge** | Answers questions by searching PARA docs first, falls back to research + create |
| **web-search** | Single source of truth for web search methodology and tier selection |
| **create-doc** | Document creation standards: citation workflow, classification rules, atomic principles |
| **summarize-link** | Fetches, summarizes, and saves URL content as a new PARA document |
| **auto-link** | LLM-powered semantic `[[wikilink]]` generation |
| **brainstorm** | Clarifies and refines questions before research |
| **research** | In-depth research workflow combining search, summarization, and creation |

---

## Development

### Scripts

```bash
npm run lint          # ESLint check
npm run lint:fix      # ESLint auto-fix
npm run format        # Prettier format
npm run format:check  # Prettier check
npm run typecheck     # TypeScript type checking (tsc --noEmit)
npm run check:lines   # File length check (≤300 lines)
npm run test          # Run vitest tests
npm run test:coverage # With coverage report
npm run test:changed  # Only changed files
npm run precommit     # Full pre-commit: format → lint → typecheck → lines → test
```

### Quality gates

| Gate | Threshold |
|------|-----------|
| File length | ≤300 lines |
| ESLint complexity | ≤15 |
| Test coverage (statements) | ≥70% |
| Test coverage (branches) | ≥60% |
| Test coverage (functions) | ≥70% |
| Test coverage (lines) | ≥70% |
| TypeScript | strict mode |

Husky pre-commit hooks enforce the full pipeline automatically.

### Project structure

```
paradocs/
├── extensions/           # 7 pi extensions (auto-discovered)
│   ├── para-knowledge/   # 6 tools: search, CRUD, citations, tags, dedup
│   ├── web-search/       # 1 tool: 3-tier web search
│   ├── link-summarizer/  # 2 tools: URL fetch + summarize
│   ├── batch-create/     # 1 tool: batch PARA doc creation
│   ├── expand-bullets/   # 1 tool: bullet → paragraph expansion
│   ├── yaml-enforcer/    # 3 tools: frontmatter validation/repair
│   └── skill-gate.ts     # Event interceptor (search-first enforcement)
├── skills/               # 7 SKILL.md workflow definitions
├── common/               # Shared modules (slug, tokenize, yaml, env)
├── types/                # Type stubs (citation-js, etc.)
├── tests/                # Vitest test files
├── docs/                 # ADRs, specs, plans
├── package.json
└── ARCHITECTURE.md
```

---

## Design decisions

- **No `src/` directory** — extension directories ARE the source, auto-discovered by `pi install`
- **Configuration via environment** — three-layer cascade, no config files
- **Soft gating** — skill-gate warns rather than blocks; the agent is informed, not obstructed
- **Search-first workflow** — prevents duplicate notes by enforcing search before create
- **Copy exactly, then refactor** — first migration pass was byte-for-byte with only import path updates

---

## License

MIT — see [LICENSE](LICENSE) for details.
