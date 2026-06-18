---
name: research
description: Iterative academic research on a topic using WHY/HOW decomposition, hypothesis-driven evidence gathering via web-search skill (tier 1 academic), and synthesis into linked atomic notes via create-doc skill.
---

# Research Skill

Triggered by "research about {topic}" or "/skill:research {question}".

## Workflow

### 1. Core question formulation

Parse the user's topic into a clear, focused research question. If the topic is vague, run `/skill:brainstorm` first to clarify.

Examples:
- "research about dopamine and motivation" → "How does dopamine signaling in the mesolimbic pathway modulate motivation and reward-seeking behavior?"
- "research about sleep and memory consolidation" → "What are the neural mechanisms by which sleep facilitates memory consolidation?"

### 2. Decompose into WHY/HOW/WHAT question tree

Start by generating exactly **one WHY** question and **one HOW** question. For each of those two top-level questions, subsequently generate **three WHAT** questions that substantively support the coherence and importance of the WHY/HOW question.

This produces 8 questions total: 2 top-level (1 WHY, 1 HOW) + 6 supporting WHAT questions (3 per top-level).

Guidelines:
- The WHY question should probe causal mechanisms, reasons, or justifications
- The HOW question should probe processes, mechanisms, or implementation pathways
- The WHAT questions should unpack specific evidence, conditions, comparisons, or sub-components that make the WHY/HOW answerable
- Together the tree should cover the full scope of the core question
- Label them Q1 (WHY), Q1.1/1.2/1.3 (WHAT supporting Q1), Q2 (HOW), Q2.1/2.2/2.3 (WHAT supporting Q2)

Example for "How does dopamine modulate motivation?":
```
Q1 (WHY): Why does dopamine depletion reduce effort expenditure in motivated behavior?
  Q1.1 (WHAT): What brain regions show altered activity when dopamine is depleted during effort-based decision making?
  Q1.2 (WHAT): What experimental paradigms best isolate the effect of dopamine on motivation versus motor function?
  Q1.3 (WHAT): What downstream signalling pathways mediate the effort-reducing effects of dopamine depletion?

Q2 (HOW): How do tonic vs phasic dopamine firing patterns differentially affect motivation?
  Q2.1 (WHAT): What distinct motivational processes are modulated by tonic versus phasic dopamine release?
  Q2.2 (WHAT): What receptor subtypes (D1 vs D2) are preferentially engaged by each firing mode?
  Q2.3 (WHAT): What behavioural tasks reliably dissociate the contributions of each firing mode?
```

### 3. For each question in the tree: hypothesize, search, collect evidence

Process the question tree top-down. Start with Q1 (WHY) and its supporting Q1.1–Q1.3, then Q2 (HOW) and Q2.1–Q2.3. The WHAT questions exist to surface specific evidence that answers the WHY/HOW — treat them as probes, not independent topics.

#### 3a. Hypothesize

Propose a preliminary answer for each top-level question. State it as a falsifiable hypothesis.

Format:
```
Q1 (WHY): Why does dopamine depletion reduce effort expenditure in motivated behavior?
Hypothesis: Dopamine depletion impairs the encoding of reward value relative to effort cost, specifically in the anterior cingulate cortex and ventral striatum.

Q1.1 (WHAT): What brain regions show altered activity when dopamine is depleted?
Hypothesis: Reduced BOLD signal in ventral striatum and anterior cingulate during effort-cost computation, with compensatory activity in prefrontal regions.
```

#### 3b. Search via web-search skill

Run `/skill:web-search` with **tier=1** using each question as query, prioritising the top-level (WHY/HOW) questions. Use the WHAT questions as secondary search terms if top-level results are thin.

```
/skill:web-search "<question text>"
```

This defaults to tier 1 (academic). If you need broader sources for conflicting evidence, pass `tier=2`.

If results are thin, run a second search with alternative phrasing or key terms extracted from the question.

#### 3c. Fetch and extract evidence

For each promising result, use `fetch_url` to retrieve the full content (PDF or HTML).

Read the content. Extract:
- **Core finding** — What does the paper claim?
- **Evidence type** — Experimental data, meta-analysis, theoretical framework, review?
- **Confidence markers** — Sample size, effect size, statistical significance, replication status
- **Limitations** — The paper's own stated caveats

#### 3d. Update hypothesis

Refine the hypothesis based on the evidence. Note whether evidence:
- **Supports** — Hypothesis is consistent with findings
- **Contradicts** — Evidence conflicts with hypothesis
- **Nuances** — Evidence adds complexity (e.g., "it depends on X")
- **Gap** — No direct evidence found

#### 3e. Check for conflicting evidence

For each top-level (WHY/HOW) question, also search for conflicting or alternative positions.

```
/skill:web-search "<question> conflicting evidence OR alternative theory"
```

If found, note the disagreement. If not found, state "no conflicting evidence found in this search round."

### 4. Completion criteria check (after each round)

A research cycle is complete when **all** five criteria are met:

| # | Criterion | Check |
|---|---|---|
| 1 | **Decomposition done** | Core question broken into 1 WHY + 1 HOW, each with 3 supporting WHAT questions |
| 2 | **Each top-level question has ≥1 academic source** | Q1 (WHY) and Q2 (HOW) each have at least one tier 1 result that directly addresses them |
| 3 | **Evidence covers both sides** | For Q1 and Q2, explicitly checked for confirming AND conflicting evidence. If only one side exists, note that as a gap |
| 4 | **Self-confidence score assigned per top-level question** | Score Q1 and Q2: **high** (multiple consistent peer-reviewed sources), **moderate** (one source or indirect), **low** (speculative / no direct sources) |
| 5 | **≤ 5 search rounds** | Hard cap. If criteria 1–4 not met after 5 rounds, produce best-effort synthesis with a "gaps and limitations" section |

If criteria are not met and rounds < 5, go back to step 3 with refined queries.

### 5. Synthesize findings

Across all questions in the tree, integrate the evidence into a coherent picture.

- Identify which claims are **well-supported** (high confidence, multiple sources)
- Identify which claims are **tentative** (moderate/low confidence, single source)
- Identify **cross-cutting themes** — patterns that appear across multiple questions
- Identify **contradictions** — questions where evidence conflicts

### 6. Create atomic notes via create-doc skill

Create one atomic note per **key idea** discovered during research.

Run `/skill:create-doc` for each atomic note. The create-doc skill handles tag selection, classification, citation, and formatting.

Research-specific rules to pass to create-doc:
- Use `batch_create_para_docs` for all atomic notes in one call (enables auto-linking)
- Default area: `Resources`. Use `Areas` if it relates to an ongoing life responsibility.
- Naming convention: `research-{short-topic}-{idea-slug}.md`
- Body structure: lean — just the key idea in 2–4 paragraphs with inline citations

### 7. Create executive summary

Create one executive summary note that links to all atomic notes. Use `/skill:create-doc` with the following structure:

```markdown
## Executive Summary

[A concise 2–3 paragraph overview of the research findings, synthesising across all questions in the tree, with sources cited as @citekey]

## Key Findings

- **[Idea 1]** — [[wikilink to note 1]]
- **[Idea 2]** — [[wikilink to note 2]]
- **[Idea 3]** — [[wikilink to note 3]]

## Confidence Assessment

| Question | Confidence | Rationale |
|---|---|---|
| Q1 (WHY): ... | High/Moderate/Low | Brief reasoning |
| Q2 (HOW): ... | High/Moderate/Low | Brief reasoning |

## Known Gaps

Open issues from the literature and things this research did not resolve:

- [Gap 1 — specific limitation from a cited paper]
- [Gap 2 — conflicting evidence that could not be resolved]
- [Gap 3 — question where no direct source was found]
- [Gap 4 — question that arose during research but was not answered]
```

Include the executive summary in the same `batch_create_para_docs` call as the atomic notes. Naming convention: `research-{short-topic}-executive-summary.md`.

### 8. Auto-link to existing notes

After creation, run `/skill:auto-link` to find semantically related notes outside the current research set and append [[wikilinks]].

### 9. Confirm with the user

Report:
- Number of atomic notes created + their paths
- Executive summary path
- Overall confidence level
- Key known gaps
- Offer to refine any note or explore deeper on specific gaps

## Completion criteria reference card

```
1. Decomposition done? (1 WHY + 1 HOW, each with 3 WHAT questions)
2. Each top-level question has ≥1 academic source?
3. Both confirming AND conflicting evidence checked per top-level question?
4. Self-confidence score assigned per top-level question?
5. Rounds ≤ 5?
```

If all yes → synthesize + create notes.
If any no and rounds < 5 → refine and search again.
If any no and rounds ≥ 5 → best-effort with "gaps and limitations".

## Self-confidence rubric

| Score | Definition |
|---|---|
| **High** | ≥2 peer-reviewed sources from reputable journals, consistent findings, direct relevance to sub-question |
| **Moderate** | 1 peer-reviewed source or indirect evidence (e.g., review mentions the mechanism but isn't the primary study), or preprints |
| **Low** | No direct academic source found; answer is inferred, speculative, or based on non-academic sources |
