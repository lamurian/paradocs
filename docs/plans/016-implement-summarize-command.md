---
title: Implement Summarize Command
description: Implement /summarize command handler
status: {{status}}
date: 2026-06-20
---

# Overview

Implement /summarize command that initiates URL summarization. The command fetches content, checks for existing summaries via the API-like command interface, and outputs a structured response the agent can process to create a document.

# Goals

- /summarize <url> fetches URL content, checks dedup, and outputs a summarization prompt
- Since commands don't call tools directly, the handler formats a structured prompt for the agent with the URL and instructions

# Implementation Steps

- [ ] Implement extensions/commands/summarize.ts:
  - Parse args as URL
  - Validate URL format
  - Output structured prompt telling the agent to:
    1. Call find_existing_summary(url) for dedup
    2. If exists, read and present existing doc
    3. If not, call fetch_url(url) to get content
    4. Summarize content
    5. Call create_para_doc with summary and source URL
    6. Auto-link runs automatically
  - Include classification guidance: default area=Resources, tags from list_para_tags

# Risks

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| URL doesn't start with http(s) | Medium | Low | Prepend https:// if no protocol |
| Agent skips steps in the prompt | Medium | Medium | Format as imperative checklist, not prose |

# UAT

1. Run `/summarize https://example.com` — outputs structured prompt with URL
2. Run `/summarize` without args — shows usage help

This plan implements @docs/specs/023-summarize-command-workflow.md
