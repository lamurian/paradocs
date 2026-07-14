/**
 * Research plan formatting for the /research command.
 *
 * Provides the WHY/HOW/WHAT decomposition prompt and the
 * formatResearchPlan function that generates the structured
 * research plan for agent execution.
 *
 * @module extensions/commands/research-format
 */

/** System prompt for WHY/HOW/WHAT decomposition of a research topic. */
export const DECOMPOSITION_PROMPT = `You are a research methodology expert. Given a research topic, decompose it into a structured question tree using the WHY/HOW/WHAT framework.

Output format — return ONLY a JSON object with this exact structure:
{
  "why": {
    "question": "Why is this topic important or worth studying?",
    "supporting": [
      "What evidence supports the significance of this topic?",
      "What are the key mechanisms or drivers?",
      "What are the broader implications or consequences?"
    ]
  },
  "how": {
    "question": "How does this topic function or manifest?",
    "supporting": [
      "What methods or approaches are used to study it?",
      "What measurements or indicators are relevant?",
      "What are the practical applications or interventions?"
    ]
  }
}

Generate exactly 1 WHY question, 1 HOW question, and 3 supporting WHAT questions for each.
Keep each question concise (under 20 words). Focus on academic research angles.

Example for "dopamine and motivation":
{
  "why": {
    "question": "Why is dopamine central to motivation?",
    "supporting": [
      "What is the neurobiological evidence linking dopamine to incentive salience?",
      "What distinguishes dopamine's role in wanting versus liking?",
      "How do dopamine dysregulation disorders affect motivation?"
    ]
  },
  "how": {
    "question": "How does dopamine signalling drive motivated behaviour?",
    "supporting": [
      "What experimental methods reveal dopamine's role in reward prediction?",
      "What measurements quantify dopamine release during goal-directed behaviour?",
      "How do pharmacological and optogenetic interventions modulate motivation?"
    ]
  }
}

Return ONLY the JSON object. No markdown, no explanation, no code fences.`;

/**
 * Format a structured research plan from the LLM's question tree output.
 *
 * Outputs a three-phase search strategy with confidence scoring, completion
 * criteria checklist, and atomic note naming convention.
 *
 * @param topic         The original research topic.
 * @param questionTree  JSON string of the WHY/HOW/WHAT decomposition.
 * @returns             The formatted research plan prompt.
 */
export function formatResearchPlan(topic: string, questionTree: string): string {
  return [
    `## Research Plan: ${topic}\n`,
    `I've analysed existing PARA documents and determined that this topic needs fresh research. Here is a structured research plan.\n`,
    `### Question Tree\n`,
    `${questionTree}\n`,
    `### Search Strategy\n`,
    `Execute the following phases in order:\n`,
    "**Phase 1: Broad search** — Search the web for the overall topic using `web_search` to get context and identify key sub-topics.",
    "**Phase 2: Decomposed search** — For each top-level question (WHY and HOW), search with `web_search` `tier=1` (academic). Hard cap: **5 search rounds total** across all questions.",
    "**Phase 3: Gap fill** — For each WHAT supporting question, refine search if gaps remain after Phases 1-2.\n",
    `For each source found:`,
    "1. `fetch_url` to retrieve full content",
    "2. `resolve_citation` with the URL to register in @ref.bib",
    "3. Extract key evidence and note @citekey for citations",
    "4. `create_para_doc` for each distinct finding\n",
    `### Confidence Scoring\n`,
    `Rate each top-level finding:`,
    "- **High** — ≥2 peer-reviewed sources supporting the conclusion",
    "- **Moderate** — 1 credible source (academic or authoritative)",
    "- **Low** — Speculative, single non-academic source, or no direct evidence\n",
    `### Completion Criteria\n`,
    "- [ ] WHY question has ≥1 sourced answer with confidence scored",
    "- [ ] HOW question has ≥1 sourced answer with confidence scored",
    "- [ ] Both supporting and conflicting evidence checked",
    "- [ ] ≤5 search rounds used",
    "- [ ] All 8 questions addressed (WHY + 3 WHAT + HOW + 3 WHAT)",
    "- [ ] Atomic notes created for each distinct finding\n",
    `### Note Creation Tips\n`,
    "- Use **`batch_create_para_docs`** for creating multiple notes in one call — this auto-links all notes to each other.",
    "- If a finding exceeds 6 paragraphs or 3 headings, split it into multiple atomic notes using `batch_create_para_docs`.",
    "- Each atomic note should cover exactly one key idea/theme. Decompose broad findings into separate notes.",
    "- The agent **decides per-note** which PARA directory fits best: **Resources** for reference/theory, **Areas** for skills/responsibilities, **Projects** for deliverables/practical work.\n",
    "Start by calling `search_para_docs` with the topic to check for any additional existing knowledge before searching the web.",
  ].join("\n");
}
