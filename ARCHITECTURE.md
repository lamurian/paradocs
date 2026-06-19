---
title: System Architecture
description: Paradocs — PARA Knowledge Management for pi
date: 2026-06-19
---

# Overview

Paradocs is a standalone pi extension package that brings PARA
(Projects, Areas, Resources, Archives) knowledge management to pi.
Extracted from Cognoscere with a focused scope: 7 extensions, 7 skills,
and 3 shared modules. No src/ directory — extensions ARE the source.

# Design Principles

- **No src/ directory**: Extensions in `extensions/` are auto-discovered by
  `pi install`. Shared code lives in `common/`, types in `types/`.
- **Configuration via environment**: Three-layer cascade (defaults →
  global ~/.pi/agent/.env → project .pi/.env) with typed getters.
- **Soft gating**: The skill-gate warns rather than blocks — the agent is
  informed, not obstructed.
- **Quality-first**: TypeScript strict, ESLint (complexity ≤15), 300-line
  file limit, vitest with coverage thresholds.
- **Copy exactly, then refactor**: First migration pass is byte-for-byte
  with only import path updates.

# System Architecture

## Configuration Layer (common/env.ts)

Three-layer dotenv cascade. Exports typed interfaces (KnowledgeConfig,
SearxngConfig, ObscuraConfig, ApiKeysConfig) and synchronous getters.
All env vars have hardcoded defaults. Tilde expansion for KNOWLEDGE_DIR.

## Extensions (7)

| Extension | Type | Purpose |
|---|---|---|
| para-knowledge/ | 6 tools | SQLite FTS5 PARA search, create, update, tags, citation, dedup |
| web-search/ | 1 tool | 3-tier SearXNG→Tavily→Bing web search |
| link-summarizer/ | 2 tools | URL fetch via CDP→HTTP→PDF→Tavily |
| batch-create/ | 1 tool | Batch PARA doc creation with auto-linking |
| expand-bullets/ | 1 tool | Bullet → paragraph via web research |
| yaml-enforcer/ | 3 tools | Frontmatter validation, check, standardize |
| skill-gate.ts | event interceptor | Search-first workflow enforcement |

## Shared Modules (common/)

slug.ts (slugify), tokenize.ts (BM25 tokenizer), yaml.ts (frontmatter
formatting). Consumed by multiple extensions.

## Skills (7)

SKILL.md files that orchestrate workflows: knowledge, create-doc,
web-search, summarize-link, brainstorm, auto-link, research.

## Data Flow

1. User asks question → skill-gate requires search_para_docs first
2. search_para_docs queries SQLite FTS5 index (at KNOWLEDGE_DIR/KNOWLEDGE_DB)
3. If no matches or partial → web_search via SearXNG → Tavily fallback
4. Agent creates atomic notes (create_para_doc / batch_create_para_docs)
5. yaml-enforcer auto-repairs frontmatter after creation
6. auto-link skill runs [[wikilink]] semantic linking
7. Evidence updates trigger re-search via web_search

# Implementation Status

All documents are at `implemented` status.

## ADRs (8/8)

- [x] ADR 001 — Migration Architecture (7 extensions, 7 skills, 3 shared
  modules migrate; set-temperature, scope-gate, roadmap-scratchpad removed)
- [x] ADR 002 — Environment Variable Configuration (three-layer cascade:
  defaults → global ~/.pi/agent/.env → project .pi/.env)
- [x] ADR 003 — Toolchain & Quality Gates (TypeScript strict + ESLint +
  Prettier + Husky + vitest with 70/60/70/70 coverage)
- [x] ADR 004 — Skill Gate Workflow Enforcement (event interceptor with
  soft warnings for search-first-ask-later workflow)
- [x] ADR 005 — Unit Test Strategy & Coverage Gates (≥80% coverage
  hard gate via vitest with mocked network layers)
- [x] ADR 006 — Remove Roadmap Skill (delete orphaned roadmap skill,
  update all cross-references)
- [x] ADR 007 — Markdown Link Format for PARA Cross-References (replace
  [[slug]] wikilinks with standard [title](path.md) markdown links)
- [x] ADR 008 — Auto-Link Skill Output Migration (migrate auto-link skill
  output from wikilinks to standard markdown links)

## Specs (19/19)

- [x] Spec 001 — Shared Modules Migration
- [x] Spec 002 — Type Stubs Migration
- [x] Spec 003 — Extensions Migration
- [x] Spec 004 — Skills Migration
- [x] Spec 005 — Scripts Migration
- [x] Spec 006 — Removed Components
- [x] Spec 007 — Env Loading Mechanism
- [x] Spec 008 — Typed Config Interfaces
- [x] Spec 009 — TypeScript and ESLint Configuration
- [x] Spec 010 — Pre-commit Hooks and Test Runner
- [x] Spec 011 — Skill Gate Implementation
- [x] Spec 012 — Pure Function Extension Tests
- [x] Spec 013 — SQLite-Dependent Extension Tests
- [x] Spec 014 — Mocked Network & Gate Tests
- [x] Spec 015 — Coverage Config & Hard Gate
- [x] Spec 016 — Remove Roadmap Skill
- [x] Spec 017 — Link Format Specification (standard markdown [title](path.md)
  format with title resolution from files table)
- [x] Spec 018 — Auto-Link Skill Output Update (update auto-link output to use
  standard markdown link format)
- [x] Spec 019 — Downstream Skill References (update all skills referencing
  wikilinks to use new markdown link format)

## Cross-Reference Format

All PARA cross-references use standard Markdown link syntax:

```markdown
[Display Title](path-from-knowledge-dir.md)
```

- **Title resolution**: Queried from the SQLite `files` table via
  `SELECT title FROM files WHERE path = ?`. Falls back to the filename stem
  (slug) if the path is not found.
- **Path convention**: Full relative path from the knowledge base root,
  including the PARA area prefix (e.g., `Resources/note-title.md`). The
  `.md` extension is included for direct rendering compatibility.
- **Scope**: Applies to all "Relevant notes" sections, template placeholders,
  and link output across all skills and extensions.
- **Reference implementation**: `extensions/batch-create/search.ts`
  `appendLinks()` — see ADR 007 and Spec 017 for full details.

## Quick reference

See [README.md](README.md) for full usage, [docs/ADR/](docs/ADR/) for architecture
decisions, and [docs/specs/](docs/specs/) for detailed specifications.
