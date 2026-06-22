/**
 * /research command — iterative academic research workflow.
 *
 * Decomposes a topic via WHY/HOW decomposition using the LLM, then outputs
 * a structured research plan for the agent to execute step by step.
 *
 * @module extensions/commands/research
 */

import { complete, type UserMessage } from "@earendil-works/pi-ai";
import { BorderedLoader } from "@earendil-works/pi-coding-agent";

import { ensureNotesDb } from "../../common/notesDb.js";

import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

/** Human-readable description shown in /commands list */
export const description = "Run iterative academic research on a topic";

/** System prompt for WHY/HOW/WHAT decomposition of a research topic. */
const DECOMPOSITION_PROMPT = `You are a research methodology expert. Given a research topic, decompose it into a structured question tree using the WHY/HOW/WHAT framework.

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
 * Create the /research command handler.
 *
 * Factory pattern: captures the ExtensionAPI reference so the handler
 * can inject structured research plans via pi.sendUserMessage().
 *
 * @param pi  The pi extension API instance.
 * @returns   The command handler function.
 */
export function createHandler(pi: ExtensionAPI) {
  return async (args: string, ctx: ExtensionCommandContext): Promise<void> => {
    const topic = args.trim();

    if (!topic) {
      ctx.ui.notify("Usage: /research <topic> — please provide a research topic.", "warning");
      return;
    }

    if (!ctx.model) {
      ctx.ui.notify("No model selected. Please select a model first (Ctrl+P).", "error");
      return;
    }

    // Guard: ctx.ui.custom requires TUI (interactive) mode
    if (typeof ctx.ui.custom !== "function") {
      ctx.ui.notify("/research requires interactive (TUI) mode.", "error");
      return;
    }

    try {
      // Capture model reference in a local const for type narrowing
      const model = ctx.model as Parameters<typeof complete>[0];

      // Warm up the DB cache for downstream operations
      await ensureNotesDb(ctx.cwd);

      // Show loader while LLM generates the question tree
      const questionTree = await ctx.ui.custom<string | null>((tui, theme, _kb, done) => {
        const loader = new BorderedLoader(
          tui,
          theme,
          `🔬 Decomposing research topic using ${(model as { id: string }).id}...`,
        );
        loader.onAbort = () => done(null);

        const doDecomposition = async () => {
          const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);

          if (!auth.ok || !auth.apiKey) {
            throw new Error(
              auth.ok ? `No API key for ${(model as { provider: string }).provider}` : auth.error,
            );
          }

          const userMessage: UserMessage = {
            role: "user",
            content: [{ type: "text", text: topic }],
            timestamp: Date.now(),
          };

          const response = await complete(
            model,
            { systemPrompt: DECOMPOSITION_PROMPT, messages: [userMessage] },
            { apiKey: auth.apiKey, headers: auth.headers, signal: loader.signal },
          );

          if (response.stopReason === "aborted") {
            return null;
          }

          // Extract text from response
          const text = response.content
            .filter((c): c is { type: "text"; text: string } => c.type === "text")
            .map((c) => c.text)
            .join("\n");

          return text;
        };

        doDecomposition()
          .then(done)
          .catch(() => done(null));

        return loader;
      });

      if (questionTree === null) {
        ctx.ui.notify("Research plan generation cancelled.", "info");
        return;
      }

      // Format the structured research plan
      const researchPlan = formatResearchPlan(topic, questionTree);

      // Inject the plan as a user message for the agent to execute
      pi.sendUserMessage(researchPlan);

      await Promise.resolve();
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      ctx.ui.notify(`❌ /research error: ${msg}`, "error");
    }
  };
}

/**
 * Format a structured research plan from the LLM's question tree output.
 *
 * @param topic         The original research topic.
 * @param questionTree  JSON string of the WHY/HOW/WHAT decomposition.
 * @returns             The formatted research plan prompt.
 */
export function formatResearchPlan(topic: string, questionTree: string): string {
  const topicSlug = topic
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);

  return [
    `## Research Plan: ${topic}\n`,
    `I've decomposed this topic into a WHY/HOW/WHAT question tree. Let's execute the research step by step.\n`,
    `### Question Tree\n`,
    `${questionTree}\n`,
    `### Research Instructions\n`,
    `Execute the following steps in order:\n`,
    `1. **Hypothesise** — For each top-level question (WHY and HOW), form a hypothesis about what evidence you expect to find.`,
    `2. **Search** — Use \`web_search\` with \`tier=1\` (academic) for each supporting WHAT question. Hard cap: **5 search rounds total** across all questions.`,
    `3. **Fetch** — Use \`fetch_url\` to retrieve full content from the most promising results.`,
    `4. **Extract** — Extract key evidence that supports or refutes each hypothesis.`,
    `5. **Check both sides** — Actively look for conflicting evidence. Update hypotheses if needed.`,
    `6. **Score confidence** — Rate each finding:`,
    `   - **High**: ≥2 peer-reviewed sources`,
    `   - **Moderate**: 1 credible source`,
    `   - **Low**: Speculative or single non-academic source`,
    `7. **Synthesise** — Summarise findings across all 8 questions into a coherent answer.\n`,
    `### Completion Criteria\n`,
    `Before concluding, verify:`,
    `- [ ] WHY question has ≥1 sourced answer`,
    `- [ ] HOW question has ≥1 sourced answer`,
    `- [ ] Both supporting and conflicting evidence checked`,
    `- [ ] Confidence scored for each top-level question`,
    `- [ ] ≤5 search rounds used`,
    `- [ ] Decomposition is complete (all 8 questions addressed)\n`,
    `### Atomic Note Naming\n`,
    `When creating knowledge documents, use:`,
    `- \`Resources/research-${topicSlug}-{idea-slug}.md\` for each atomic note`,
    `- \`Resources/research-${topicSlug}-executive-summary.md\` for the synthesis\n`,
    `Proceed step by step. Call \`search_para_docs\` first to check for existing knowledge before searching the web.`,
  ].join("\n");
}
