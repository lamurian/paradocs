---
title: System Architecture
description: Paradocs — PARA Knowledge Management for pi
date: 2026-06-19
---

# Overview

Paradocs is a standalone pi extension package that brings PARA
(Projects, Areas, Resources, Archives) knowledge management to pi.
Extracted from Cognoscere with a focused scope: 7 extensions, 8 skills,
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

## Skills (8)

SKILL.md files that orchestrate workflows: knowledge, create-doc,
web-search, summarize-link, brainstorm, auto-link, research, roadmap.

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

## ADRs (5/5)

- [x] ADR 001 — Migration Architecture (7 extensions, 8 skills, 3 shared
  modules migrate; set-temperature, scope-gate, roadmap-scratchpad removed)
- [x] ADR 002 — Environment Variable Configuration (three-layer cascade:
  defaults → global ~/.pi/agent/.env → project .pi/.env)
- [x] ADR 003 — Toolchain & Quality Gates (TypeScript strict + ESLint +
  Prettier + Husky + vitest with 70/60/70/70 coverage)
- [x] ADR 004 — Skill Gate Workflow Enforcement (event interceptor with
  soft warnings for search-first-ask-later workflow)
- [x] ADR 005 — Unit Test Strategy & Coverage Gates (≥80% coverage
  hard gate via vitest with mocked network layers)

## Specs (15/15)

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

## Quick reference

See [README.md](README.md) for full usage, [docs/ADR/](docs/ADR/) for architecture
decisions, and [docs/specs/](docs/specs/) for detailed specifications.
