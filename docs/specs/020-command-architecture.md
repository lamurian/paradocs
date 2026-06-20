---
title: Command Architecture
description: Command Architecture
status: proposed
remaining: 0
date: 2026-06-20
---

# Requirements Specification

- Register all slash commands from a single extensions/commands/index.ts entry point
- Each command handler lives in its own file (ask.ts, research.ts, summarize.ts) for modularity
- Commands use pi.registerCommand() with description and handler function
- Shared utilities (LLM prompting, error handling, common tool calls) live in a shared module or are inlined per command
- All commands receive args and ctx (ExtensionCommandContext) per pi SDK
- Output results via ctx.ui.notify() for feedback
- Follow project conventions: 300-line max per file, JSDoc on exported functions, TypeScript strict

# Design Principles

- Directory structure:
  ```
  extensions/commands/
  ├── index.ts        # Registers all 3 commands
  ├── ask.ts          # /ask handler
  ├── research.ts     # /research handler
  └── summarize.ts    # /summarize handler
  ```
- index.ts imports each handler module and calls pi.registerCommand()
- Each handler is an async function receiving (args: string, ctx: ExtensionCommandContext)
- Commands run synchronous tool chains — no background processing
- Error handling: wrap in try/catch, report via ctx.ui.notify('error')

# References

- ADR 009: @docs/ADR/009-slash-command-workflows.md
- pi SDK docs: ExtensionCommandContext for command handlers
- pi packages.md: extension auto-discovery conventions

This spec implements @docs/ADR/009-slash-command-workflows.md
