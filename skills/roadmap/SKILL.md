---
name: roadmap
description: Orchestrates the creation of a structured learning pathway (roadmap) for any topic, from fundamentals to practical application. Delegates search to web-search skill and document creation to create-doc skill.
---

# Roadmap Skill — Learning Pathway Orchestrator

When the user asks to outline a learning pathway, roadmap, or curriculum for a certain topic, follow this workflow.

## Trigger phrases

The user may say things like:
- "Outline a learning pathway for X"
- "Create a roadmap to learn X"
- "I want to learn X, where do I start?"
- "Design a curriculum for X"
- "How do I become proficient in X?"

## Workflow overview

```
User request
    │
    ▼
Step 0: Check for existing scratchpad → resume or start fresh
    │
    ▼
Step 1: Clarify scope (engage user)
    │
    ▼
Step 2: Formulate learning steps (Layers 1–5)
    │
    ▼
Step 3: Generate guiding questions per step
    │
    ▼
[Present Steps 2+3 to user for approval]
    │
    ▼
Step 4: Init scratchpad (record steps, questions, todo list)
    │
    ▼
Step 5: Search PARA notes + web per step via web-search skill
    │  (update scratchpad: mark search as done, record results)
    │
    ▼
Step 6: Create atomic PARA docs via create-doc skill
    │
    ▼
Step 7: Create master roadmap in Projects/roadmap-*.md via create-doc skill
    │
    ▼
Step 8: Delete scratchpad (cleanup)
    │
    ▼
Confirm with user, present the full roadmap
```

---

## Step 0 — Check for existing scratchpad

Before starting work, check whether a scratchpad for this topic already exists in the knowledge base.

```
search_para_docs(query: "<topic from user>", tags: ["scratchpad", "roadmap"])
```

### If a scratchpad is found

1. `read` the scratchpad file (path from search results)
2. Parse the JSON body to extract current state:
   - `steps` — which steps are `done: true` and which remain
   - `questions` — guiding questions already generated
   - `searchResults` — materials already collected
   - `milestones` — milestones already defined
3. Inform the user: "Resuming roadmap for [topic] — [X/Y] steps completed. Ready to continue with step [next]."
4. **Skip to the appropriate step below** based on what's done:
   - If steps defined but not searched → go to Step 5 (search)
   - If searched but docs not created → go to Step 6 (create docs)
   - If docs created but no master roadmap → go to Step 7 (master doc)
   - If everything done → go to Step 8 (cleanup)

### If no scratchpad is found

Proceed to **Step 1** below to start fresh.

---

## Step 1 — Clarify scope

Engage the user to define:

| Question | Purpose |
|----------|---------|
| "What is the exact topic you want a roadmap for?" | Nail down the subject |
| "Any specific perspective or school of thought?" | e.g. Bayesian vs frequentist, functional vs OOP, etc. |
| "What is your current level?" | beginner, intermediate, advanced |
| "What is your goal?" | job-ready, hobby, academic research, certification |
| "Do you have a time constraint?" | 3 months, 6 months, 1 year |

If the user's request is already detailed, you may skip some questions but **always confirm the scope** before proceeding.

If the user's request is vague, run `/skill:brainstorm` first to clarify.

---

## Step 2 — Formulate the learning steps

Decompose the topic into a **progression** from fundamental to practical. Follow this structure:

### Layer 1 — Foundations (Fundamental prerequisites)
- Prerequisite math, theory, or background knowledge
- Core concepts that everything else builds on

### Layer 2 — Core theory / Conceptual understanding
- The main theoretical body of the subject
- Key models, frameworks, or paradigms

### Layer 3 — Intermediate applied skills
- Practical techniques, tools, methods
- Hands-on exercises and applications

### Layer 4 — Advanced / Specialised topics
- Cutting-edge or niche sub-areas
- Integration of multiple concepts

### Layer 5 — Real-world application / Capstone
- Portfolio projects, case studies, or research
- Synthesis of everything learned

**For each layer**, produce 2–5 concrete steps. Each step is one atomic skill or knowledge area.

Format the output as a structured outline and **present it to the user for approval** before proceeding to Step 3.

---

## Step 3 — Generate guiding questions

For **each** step formulated in Step 2, generate 1–3 concrete questions that will guide the research for that step. These questions must be:

- **Answerable** — They should yield factual, findable answers
- **Scoped** — Narrow enough to fit a single atomic note
- **Actionable** — They help the learner understand what to study next

**Append these questions to the outline** from Step 2 and present to the user for final approval before executing research and document creation.

---

## Step 4 — Initialize the scratchpad

Once the user approves the plan (steps + questions), create a scratchpad to track progress.

Use `init_scratchpad`:

```
init_scratchpad(
  name: "<topic-slug>",
  description: "Roadmap creation: <topic> — <perspective/goal>",
  steps: [
    { id: 1, title: "1.1 Fundamental mathematics for statistics", done: false, description: "Calculus, probability axioms" },
    ...
  ],
  questions: [
    { stepId: 1, questions: ["What calculus concepts are prerequisites?", "What probability axioms are needed?"] },
    ...
  ]
)
```

This creates a searchable markdown file at `Areas/_scratchpad-<topic-slug>.md` and registers it in `notes.duckdb`.

The scratchpad JSON schema:

```json
{
  "name": "<topic-slug>",
  "description": "Concise description for searchability",
  "steps": [{ "id": 1, "title": "1.1 ...", "done": false, "description": "..." }],
  "questions": [{ "stepId": 1, "questions": ["q1", "q2"] }],
  "searchResults": [{ "stepId": 1, "results": [{"title": "...", "url": "...", "note": "..."}] }],
  "milestones": [{ "id": 1, "name": "...", "stepIds": [1,2,3], "done": false, "epic": "..." }]
}
```

---

## Step 5 — Search for materials via web-search skill

For **each step**, in order from Layer 1 to Layer 5:

### 5a. Search existing PARA notes first

```
search_para_docs(query: "<step topic and guiding question>")
```

If a relevant note already exists, record its path — reference it in the atomic note and master roadmap instead of recreating it.

### 5b. If no relevant note exists, search the web

Run `/skill:web-search` with the guiding question as query. Default to tier 2 (filtered web) for general learning material. Use tier 1 (academic) for theory-heavy steps.

```
/skill:web-search "<guiding question>" tier=2
```

For each promising result, use `fetch_url` to read the full content and extract key information.

### 5c. Collect and synthesise

For each step, collect:
- What existing PARA notes cover (path + title)
- What web sources were found (URL + title + key excerpts)
- A brief synthesis (2–3 sentences) of what the learner should know at this step

### 5d. Update scratchpad after each step's search

```
update_scratchpad(
  path: "Areas/_scratchpad-<topic-slug>.md",
  steps: [{ id: N, title: "...", done: true, description: "..." }],
  searchResults: [
    { stepId: N, results: [
      { title: "Existing note title", url: "/Resources/existing-note.md", note: "Covers this topic already" },
      { title: "Web source title", url: "https://...", note: "Key excerpt" }
    ]}
  ]
)
```

Pass ALL steps (with latest one marked `done: true`) since `update_scratchpad` does a partial merge on the steps array.

---

## Step 6 — Create atomic PARA documents via create-doc skill

For each step that needs a **new** atomic note (where no existing PARA note already covers it), run `/skill:create-doc`.

Pass the following to create-doc:
- `title` — descriptive, searchable
- `content` — 2-3 paragraphs synthesising the research from Step 5
- `tags` — create-doc will run `list_para_tags` and pick existing tags
- `classification` — use the table below to decide area

| Content type | Area | Tags |
|---|---|---|
| Foundational theory, concepts, prerequisites | Resources | roadmap, topic tag, fundamental |
| Practical techniques, tools, exercises | Projects | roadmap, topic tag, practical |
| Comparisons, frameworks, paradigms | Resources | roadmap, topic tag, reference |
| Capstone / portfolio project ideas | Projects | roadmap, topic tag, capstone |

Use `batch_create_para_docs` (via create-doc) for all atomic notes in one call to enable batch auto-linking. You do NOT need to call `/skill:auto-link` separately for intra-batch links.

### Update scratchpad after batch creation

```
update_scratchpad(
  path: "Areas/_scratchpad-<topic-slug>.md",
  steps: [/* all steps with doc-creation ones marked done */],
  milestones: [
    { id: 1, name: "Foundations of Probability and Mathematics", stepIds: [1, 2, 3], done: false, epic: "..." },
    ...
  ]
)
```

**Group steps into milestones:**
- Each milestone = one epic = one subskill mastery
- Group 2–5 related steps per milestone
- Milestones should be completable in 1–4 weeks
- Each milestone has a `stepIds` array referencing the step IDs

---

## Step 7 — Create the master roadmap document via create-doc skill

After all atomic notes are created, create the **master roadmap document** in `Projects/` using `/skill:create-doc`.

### Naming

The filename must start with `roadmap-` followed by the topic slug. Pass this as the title to create-doc.

### Document structure

```markdown
# Roadmap: [Topic Name]

## Overview
[2–3 paragraph overview: what it covers, who it is for, estimated time]

## Prerequisites
- [Any assumed prior knowledge]
- [Tools or software needed]

## Milestones

### Milestone 1: [Name]
> **Epic:** [One-sentence description]

**Steps:**
1. [[atomic-note-slug-1]] — Brief description
2. [[atomic-note-slug-2]] — Brief description

**Guiding questions:**
- Q1: ...
- Q2: ...

**Estimated effort:** [e.g. 2 weeks, 20 hours]
**Checkpoint:** [Self-assessment task]

---

### Milestone N: [Name — Capstone]
> **Epic:** [Synthesis and real-world application]

**Steps:**
1. [[capstone-note-slug]] — ...
...

**Estimated effort:** ...
**Checkpoint:** [Final project or assessment]

---

## How to use this roadmap

[Advice on navigation — learn sequentially, skip known material, revisit milestones]

## Resources and references

- [[note-slug-1]] — [description]
- [External resource links]

## Appendix: Full step list

1. Step 1 — [[slug]] → [category]
2. Step 2 — [[slug]] → [category]
...
```

Pass to create-doc:
- `area: "Projects"`
- `title: "Roadmap: <Topic>"`
- `tags: ["roadmap", "<topic>", "index"]`

### Update scratchpad

```
update_scratchpad(
  path: "Areas/_scratchpad-<topic-slug>.md",
  steps: [/* all steps marked done */],
  milestones: [/* all milestones, final version */]
)
```

---

## Step 8 — Delete the scratchpad

Once the master roadmap document is created and confirmed with the user, clean up:

```
delete_scratchpad(path: "Areas/_scratchpad-<topic-slug>.md")
```

---

## Scratchpad resume workflow

If context is lost mid-task:

1. `search_para_docs(query: "<topic>", tags: ["scratchpad", "roadmap"])` → find scratchpad
2. `read` the file → parse JSON body
3. Check `steps` array — find the first step where `done: false`
4. Check `searchResults` and `milestones` to see what's already done
5. Pick up from the appropriate step above
6. Inform the user of progress and next action

## Tools used

- `search_para_docs` — BM25 search across PARA documents (existing notes)
- `init_scratchpad` — create a new roadmap scratchpad
- `update_scratchpad` — update scratchpad state (partial merge)
- `delete_scratchpad` — delete scratchpad and clean up DuckDB
- `fetch_url` — fetch full content from web sources
