---
title: Environment Variable Configuration
description: Three-layer cascade for extension configuration via .env files, with typed access from a shared module.
status: implemented
date: 2026-06-18
---

# Context

Extensions need configuration: KNOWLEDGE_DIR for document location, KNOWLEDGE_DB for SQLite path, SearXNG host/port/secret, Obscura browser settings, Tavily API key, and optional GitHub token. Cognoscere hardcoded these in each extension. A flexible approach is needed for a standalone pi package that can work across environments. Pi's extension system doesn't provide built-in config management, so a custom solution is required.

# Decision

Use a three-layer cascade with dotenv. Hardcoded defaults are lowest priority, overridden by ~/.pi/agent/.env (global user config), then overridden by <project>/.pi/.env (project-local config). A shared common/env.ts module loads these in order using dotenv with override: true for later layers, and exports typed getter functions (getKnowledgeDir(), getSearxngConfig(), etc.). Each extension imports from this shared module. Default values match Cognoscere's current setup: KNOWLEDGE_DIR=~/data/personal/Documents/Cognoscere, KNOWLEDGE_DB=notes.db, SEARXNG_PORT=8888, etc.

# Impact

Clean separation of config from code. Users can set global defaults once in ~/.pi/agent/.env and override per-project. No hardcoded paths in extensions. All env vars are typed and documented in one place. The dotenv dependency is small and already common in Node projects. One downside: extensions must call the init function before reading config, but this is handled by a lazy singleton pattern.
