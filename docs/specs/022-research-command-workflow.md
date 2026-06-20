---
title: Research Command Workflow
description: Research Command Workflow
status: implemented
remaining: 0
date: 2026-06-20
---

# Requirements Specification

- /research <topic> runs the full academic research workflow
- Steps: (1) Clarify topic via 2-3 questions if vague, (2) decompose into WHY/HOW/WHAT question tree (1 WHY + 1 HOW, each with 3 WHAT supporting questions = 8 questions), (3) for each top-level question: hypothesize, web_search tier=1, fetch_url, extract evidence, update hypothesis, (4) check conflicting evidence, (5) check completion criteria (decomposition done, each top-level has ≥1 source, both sides checked, confidence scored, ≤5 rounds), (6) synthesize findings, (7) batch_create_para_docs atomic notes + executive summary, (8) auto-link runs automatically
- Hard cap of 5 search rounds
- Each atomic note = one key idea, ≤4 paragraphs, in Resources/ with research-{topic}-{slug}.md naming
- Executive summary note links to all atomic notes
- Confidence scoring per research.skill.md rubric: high (≥2 peer-reviewed), moderate (1 source), low (speculative)

# Design Principles

- Use LLM prompt for question decomposition and hypothesis generation (ctx.ui is for human interaction, but LLM output generation is done by prompting)
- Actually, since this is a slash command handler, it can use the LLM by sending messages — but commands don't have direct LLM access. Instead, use structured prompts that the agent will process when the command output is injected into conversation.
- Wait — slash commands return text that appears in the conversation. The workflow orchestration happens as the handler runs tool calls. For LLM-dependent steps (decomposition, hypothesis), the command can use ctx.ui to present structured output or call tools that use LLM.
- Actually, rethinking: the command handler can call tools that themselves use LLM. Or it can format prompts as command output and let the agent respond. The simplest pattern: command outputs structured steps, agent follows them.
- Simpler approach: /research outputs a structured research plan. The agent then executes each step using tools. This keeps the command lightweight and flexible.

# References

- ADR 009: @docs/ADR/009-slash-command-workflows.md
- research/SKILL.md (source workflow being replaced)
- web-search extension: web_search tool (tier=1 academic)
- batch_create_para_docs for atomic notes
- Confidence rubric and completion criteria from research.skill.md

This spec implements @docs/ADR/009-slash-command-workflows.md
