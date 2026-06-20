---
title: Implement Research Command
description: Implement /research command handler
status: {{status}}
date: 2026-06-20
---

# Overview

Implement /research command that initiates the academic research workflow. Since command handlers don't call pi tools directly, the command uses the LLM to decompose the topic into a WHY/HOW/WHAT question tree and outputs a structured research plan for the agent to execute.

# Goals

- /research <topic> uses LLM (via complete() from @earendil-works/pi-ai) to generate a WHY/HOW/WHAT question tree (8 questions: 1 WHY + 1 HOW, each with 3 supporting WHAT questions)
- Outputs a structured research prompt the agent can execute step by step
- Hard cap at 5 search rounds
- Completion criteria (decomposition done, ≥1 source per top-level question, both sides checked, confidence scored) included in the output
- Research plan formatted with clear instructions for the agent

# Implementation Steps

- [ ] Implement extensions/commands/research.ts:
  - Parse args as research topic
  - Use ctx.ui.custom() with BorderedLoader to show progress while LLM generates the question tree
  - Use complete() with a prompt template for WHY/HOW/WHAT decomposition
  - Output formatted research plan with step-by-step instructions for the agent
  - Include completion criteria and confidence rubric in the output
  - Output atomic note naming convention: research-{topic}-{idea-slug}.md

# Risks

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| LLM generates poor question tree | Medium | Medium | Include examples in system prompt |
| No model selected (ctx.model null) | Low | High | Check ctx.model first, notify if missing |

# UAT

1. Run `/research dopamine and motivation` — outputs a structured research plan with question tree
2. Run `/research` without args — shows usage help
3. Run without a model selected — shows error notification

This plan implements @docs/specs/022-research-command-workflow.md
