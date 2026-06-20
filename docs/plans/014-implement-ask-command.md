---
title: Implement Ask Command
description: Implement /ask command handler
status: {{status}}
date: 2026-06-20
---

# Overview

Implement the /ask command that searches PARA docs, falls back to web search, synthesizes answers with citations, and optionally creates a new document.

# Goals

- /ask <question> searches PARA docs via search_para_docs
- If results found: return summary with citations and [title](path) links
- If no results: ask user clarifying questions, then web_search, fetch_url, synthesize
- Option to create_para_doc on user confirmation
- Auto-link runs automatically after doc creation (handled by spec 024)
- All sources cited with @citekey or [title](path) links

# Implementation Steps

- [ ] Implement extensions/commands/ask.ts with the full workflow:
  - Parse args as the question
  - Call search_para_docs — but commands can't directly call pi tools; they output instructions
  - Actually, rethink: commands output text that becomes a system message. The agent processes it.
  - Simpler approach: /ask outputs structured response that the agent executes
  - Or: /ask returns formatted results from tools it CAN call
  - Actually, commands have ctx.ui but not tool access. They format structured prompts for the agent.
- [ ] Write the command to format a structured research prompt including the question and fallback instructions

# Risks

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Commands don't have tool access | High | High | Research pi.registerCommand() API — commands may only output text for the agent |
| Workflow too complex for a command | Medium | Medium | Keep /ask lightweight — just formats prompt, agent executes |

# UAT

1. Run `/ask what is dopamine?` — should produce a structured response
2. Run `/ask` without args — should show usage help

This plan implements @docs/specs/021-ask-command-workflow.md
