---
title: Slash Command Workflows
description: Replace orchestration skills with deterministic slash commands via pi.registerCommand()
status: implemented
remaining: 5
date: 2026-06-20
---

# Context

Current architecture has 7 skills as SKILL.md files that the AI agent reads and follows step-by-step. Skills like research have 9-step workflows with completion criteria, confidence rubrics, and delegation to 4 sub-skills. This means the agent must read all SKILL.md files each time a workflow runs, consuming context window. The agent can also skip steps or misinterpret prose instructions. pi provides registerCommand() for deterministic slash command handlers in TypeScript. Options considered: (a) keep skills as-is — fragile, context-heavy; (b) convert orchestrator skills to slash commands — deterministic, zero context overhead; (c) hybrid — confusing mental model.

# Decision

Convert 3 orchestration skills (knowledge, research, summarize-link) to slash commands in extensions/commands/index.ts via pi.registerCommand(). Register: /ask for knowledge Q&A, /research for academic research, /summarize for URL summarization. Auto-link runs automatically after doc creation inside these commands — no separate /autolink needed. Commands use the same tools as before but orchestrate them in TypeScript deterministically.

# Impact

Removes 3 skills (knowledge, research, summarize-link) from the project. Adds 3 command handlers in TypeScript (~100-200 lines each). More deterministic execution — no agent deviation from workflow. Less context window consumed. Harder to modify workflows (requires code change vs prose edit). Auto-link being automatic means one less manual step. The skills/ directory shrinks from 7 to 4 items.
