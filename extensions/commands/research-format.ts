/**
 * Research decomposition prompt for the /research command.
 *
 * Provides the WHY/HOW/WHAT decomposition prompt used to break a research
 * topic into a structured question tree before running the research engine.
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
      "What distinguishes the role of dopamine in wanting versus liking?",
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
