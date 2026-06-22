---
title: Structured Plan-Based Command Workflows
description: /ask and /research output structured text plans for the agent to execute, rather than orchestrating in JavaScript
status: proposed
remaining: 2
date: 2026-06-22
---

# Context

Current architecture: /ask is fully JS-orchestrated (runs web search, fetch, citation resolution, synthesis in the handler) while /research outputs a structured text plan for the agent. This asymmetry is confusing and the JS-orchestrated /ask has proven fragile - LLM calls inside TUI custom() add complexity and error-prone JSON parsing. The user confirmed both commands should output structured plans that the agent executes, using guardrail-enforced tools. Options considered: (a) keep /ask JS-orchestrated - fragile, complex; (b) both as structured plans - simpler, agent leverages native reasoning; (c) both JS-orchestrated - maximum determinism but high complexity and brittle.

# Decision

Convert both /ask and /research to output structured text plans that the agent executes step-by-step. /ask handler: (1) searches notes.db; (2) evaluates sufficiency; (3) if sufficient - outputs answer inline with existing source citations (no note); (4) if insufficient - outputs a structured plan with web search queries, citation steps, and instructions to create atomic notes. /research handler: (1) searches notes.db; (2) evaluates sufficiency; (3) if sufficient - outputs answer with citations; (4) if insufficient - decomposes into 1 WHY + 1 HOW core question, each with 3 WHAT supporting questions; (5) instructs broad search first, then decomposed re-search per question; (6) mandates atomic note creation for each finding. This removes the JS orchestration layer (ask-orchestrator.ts, ask-helpers.ts).

# Impact

Benefits: removes fragile JS orchestration (ask-orchestrator.ts, ask-helpers.ts); leverages the agent's native reasoning and tool-use capabilities; unified architecture across /ask and /research; simpler command handlers (~50-80 lines each). Costs: less deterministic execution - the agent may deviate from the plan (mitigated by tool-level guardrails); plan quality depends on LLM decomposition (mitigated by structured prompts with JSON output). Files to remove: ask-orchestrator.ts, ask-helpers.ts. Files to modify: ask.ts, research.ts. Migration: existing features replaced atomically - no backward compatibility needed as commands are stateless.
