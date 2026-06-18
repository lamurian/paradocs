---
name: brainstorm
description: Clarifies ambiguous or underspecified questions by engaging the user in a structured brainstorming dialogue. Use when a query lacks context or when no existing PARA document matches the user's intent.
---

# Brainstorm

Use this skill when a question is too vague, ambiguous, or when no existing document in Areas/Projects/Resources matches what the user is asking.

## Steps

1. **Flag the gap** — Tell the user: "I could not find an existing document covering this topic. Let me clarify what you need."

2. **Ask clarifying questions** — Present the original question back and ask 2–3 targeted questions to narrow scope:
   - What specific aspect are you most interested in?
   - Which domain or field does this relate to (e.g., health economics, software, mathematics)?
   - Should this go into Areas, Projects, or Resources?

3. **Refine the question** — Based on the user's answers, produce a clear, focused question statement.

4. **Hand off** — Output the refined question so it can be used by `web_search` (3-tier: SearXNG category-based search) for web search and `create_para_doc` to save a new document.

