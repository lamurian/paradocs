/**
 * Deterministic reformulation logic: facet templates, breadth facet-fill,
 * depth covered-facet exclusion, and the invalid-JSON fallback.
 *
 * @module extensions/research-engine/reformulate
 */

/** Facet template for breadth-phase question enumeration. */
export const FACET_TEMPLATE = [
  "mechanisms",
  "evidence",
  "practice/production",
  "tooling",
  "critiques/limits",
] as const;

/** Canonical breadth question per facet (deterministic fill). */
export const FACET_QUESTIONS: Record<string, (topic: string) => string> = {
  mechanisms: (t) => `What mechanisms underlie ${t}?`,
  evidence: (t) => `What empirical evidence exists for ${t}?`,
  "practice/production": (t) => `How is ${t} applied in production practice?`,
  tooling: (t) => `What tooling and frameworks exist for ${t}?`,
  "critiques/limits": (t) => `What are the critiques and limits of ${t}?`,
};

/** Keywords identifying a facet inside a question (depth exclusion). */
const FACET_KEYWORDS: Record<string, string[]> = {
  mechanisms: ["mechanism"],
  evidence: ["evidence"],
  "practice/production": ["production", "practice", "deployment"],
  tooling: ["tool", "framework", "library"],
  "critiques/limits": ["critique", "limitation", "drawback"],
};

/** Input for the deterministic reformulation post-processing. */
export interface RefineInput {
  phase: "breadth" | "depth";
  topic: string;
  /** Already-asked questions (never repeated). */
  asked: string[];
  /** Facets covered so far (depth exclusion). */
  coveredFacets: string[];
  /** Judge gaps (depth fallback source). */
  gaps: string[];
  /** Validated questions from the LLM, or null on parse failure. */
  parsed: { questions: string[]; coveredFacets: string[] } | null;
}

function dedupe(values: string[]): string[] {
  return [...new Set(values.filter((v) => v.length > 0))];
}

function matchesFacet(question: string, facet: string): boolean {
  const q = question.toLowerCase();
  return (FACET_KEYWORDS[facet] ?? [facet]).some((kw) => q.includes(kw));
}

/** Output of deterministic reformulation post-processing. */
export interface RefineResult {
  questions: string[];
  coveredFacets: string[];
  /** True when the LLM output was invalid and the fallback was used. */
  usedFallback: boolean;
}

/**
 * Post-process reformulator output deterministically.
 *
 * Breadth: fill missing facets from the facet template using canonical
 * questions. Depth: drop questions matching covered facets and any
 * already-asked question. Invalid LLM output: fall back to the existing
 * questions (or topic) plus one gap-derived question.
 *
 * @param input - Phase, topic, digest data, and parsed LLM output.
 * @returns Final question set for the next cycle.
 */
export function refineResult(input: RefineInput): RefineResult {
  const { phase, topic, asked, coveredFacets, gaps, parsed } = input;

  if (parsed === null) {
    const existing = asked.length > 0 ? dedupe(asked) : [topic];
    const gapQuestion = gaps.length > 0 ? `${topic}: ${gaps[0]}` : topic;
    return { questions: dedupe([...existing, gapQuestion]), coveredFacets, usedFallback: true };
  }

  const askedSet = new Set(asked);
  let questions = parsed.questions.filter((q) => !askedSet.has(q));

  if (phase === "depth") {
    questions = questions.filter((q) => !coveredFacets.some((f) => matchesFacet(q, f)));
  }

  const covered = dedupe([...coveredFacets, ...(parsed.coveredFacets ?? [])]);

  if (phase === "breadth") {
    const missing = FACET_TEMPLATE.filter((f) => !questions.some((q) => matchesFacet(q, f)));
    for (const facet of missing) {
      questions.push(FACET_QUESTIONS[facet](topic));
    }
    return {
      questions: dedupe(questions),
      coveredFacets: [...FACET_TEMPLATE],
      usedFallback: false,
    };
  }

  return { questions: dedupe(questions), coveredFacets: covered, usedFallback: false };
}
