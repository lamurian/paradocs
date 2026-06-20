/**
 * /ask command — knowledge Q&A workflow handler.
 *
 * Parses the user's question, formats a structured research prompt,
 * and sends it as a user message to the agent. The agent then executes
 * the workflow: PARA doc search → web search fallback → synthesis.
 *
 * @module extensions/commands/ask
 */

import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

/** Human-readable description shown in /commands list */
export const description = "Ask a question and get a knowledge document answer";

/**
 * Create the /ask command handler.
 *
 * Factory pattern: captures the ExtensionAPI reference so the handler
 * can send structured research prompts via pi.sendUserMessage().
 *
 * @param pi  The pi extension API instance.
 * @returns   The command handler function.
 */
export function createHandler(pi: ExtensionAPI) {
  return async (args: string, ctx: ExtensionCommandContext): Promise<void> => {
    const question = args.trim();

    if (!question) {
      ctx.ui.notify("Usage: /ask <question> — please provide a question.", "warning");
      return;
    }

    try {
      ctx.ui.notify(`🔍 Researching: "${question.slice(0, 80)}…"`, "info");

      const structuredPrompt = formatResearchPrompt(question);

      // Send the structured prompt as a user message, which triggers
      // the agent to execute the research workflow with tool calls.
      pi.sendUserMessage(structuredPrompt);

      // Keep ESLint's require-await rule happy — sendUserMessage is fire-and-forget
      await Promise.resolve();
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      ctx.ui.notify(`❌ /ask error: ${msg}`, "error");
    }
  };
}

/**
 * Format a structured research prompt for the agent.
 *
 * Tells the agent to search PARA docs first, fall back to web search,
 * synthesise with citations, and optionally create a new document.
 *
 * @param question  The user's research question.
 * @returns         The formatted prompt string.
 */
function formatResearchPrompt(question: string): string {
  return [
    `Please research the following question and provide a thorough answer:\n`,
    `QUESTION: ${question}\n`,
    `## Instructions`,
    ``,
    `1. **Search PARA knowledge base first** — call \`search_para_docs\` with the question as the query.`,
    `2. **If relevant documents are found**:`,
    `   - Summarise the answer using existing knowledge.`,
    `   - Cite each source as \`[title](path)\` (e.g., \`[Dopamine Function](Resources/dopamine-function.md)\`).`,
    `3. **If no relevant documents are found**:`,
    `   - Ask the user 2-3 clarifying questions to narrow the search scope.`,
    `   - Then search the web using \`web_search\` (tier=2 for general, tier=1 for academic).`,
    `   - Fetch the top results with \`fetch_url\`.`,
    `   - Synthesize an answer with proper Pandoc-style citations (\`@citekey\`).`,
    `   - Ask the user: "Shall I save this as a new knowledge document?"`,
    `4. **Always cite sources**:`,
    `   - Existing PARA docs: \`[Document Title](relative/path.md)\``,
    `   - Web sources: \`@citekey\` (resolved via \`resolve_citation\`)`,
    `5. **Document creation**: If the user confirms, create a new document via \`create_para_doc\``,
    `   in the appropriate PARA area (Resources for reference, Areas for responsibilities,`,
    `   Projects for practical work). Auto-linking runs automatically after creation.`,
    ``,
    `Proceed step by step.`,
  ].join("\n");
}
