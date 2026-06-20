/**
 * /summarize command — URL summarization workflow handler.
 *
 * Parses a URL, validates it, and sends a structured prompt to the agent
 * that guides it through dedup check, content fetch, LLM summarization,
 * citation resolution, and PARA document creation.
 *
 * @module extensions/commands/summarize
 */

import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

/** Human-readable description shown in /commands list */
export const description = "Summarise a URL into a knowledge document";

/**
 * Create the /summarize command handler.
 *
 * Factory pattern: captures the ExtensionAPI reference so the handler
 * can send structured summarization prompts via pi.sendUserMessage().
 *
 * @param pi  The pi extension API instance.
 * @returns   The command handler function.
 */
export function createHandler(pi: ExtensionAPI) {
  return async (args: string, ctx: ExtensionCommandContext): Promise<void> => {
    const rawUrl = args.trim();

    if (!rawUrl) {
      ctx.ui.notify("Usage: /summarize <url> — please provide a URL.", "warning");
      return;
    }

    // Prepend https:// if no protocol is present
    const normalizedUrl = rawUrl.match(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//)
      ? rawUrl
      : `https://${rawUrl}`;

    // Basic URL validation
    try {
      new URL(normalizedUrl);
    } catch {
      ctx.ui.notify(`❌ Invalid URL: "${rawUrl}". Please provide a valid URL.`, "error");
      return;
    }

    try {
      ctx.ui.notify(`📄 Summarising: "${normalizedUrl.slice(0, 80)}…"`, "info");

      pi.sendUserMessage(formatSummarizePrompt(normalizedUrl));

      await Promise.resolve();
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      ctx.ui.notify(`❌ /summarize error: ${msg}`, "error");
    }
  };
}

/**
 * Format a structured summarization prompt for the agent.
 *
 * Guides the agent through dedup check, content fetch, summarization,
 * citation resolution, and PARA document creation with classification
 * guidance.
 *
 * @param url  The normalized URL to summarise.
 * @returns    The formatted prompt string.
 */
function formatSummarizePrompt(url: string): string {
  return [
    `Please summarise the following URL into a knowledge document:\n`,
    `URL: ${url}\n`,
    `## Instructions`,
    ``,
    `1. **Check for existing summary** — Call \`find_existing_summary("${url}")\` first.`,
    `   - If a document already exists: read it and present the existing document to the user.`,
    `   - If not, proceed with the steps below.`,
    `2. **Fetch content** — Call \`fetch_url("${url}")\` to retrieve the page content.`,
    `   (This handles HTML via Obscura/HTTP and PDF via pdftotext automatically.)`,
    `3. **Summarize** — Use the fetched content to write a concise summary (2–5 paragraphs).`,
    `4. **Resolve citation** — Call \`resolve_citation\` with the source URL so a BibTeX entry is created.`,
    `5. **List existing tags** — Call \`list_para_tags\` to see available tags. Reuse existing tags.`,
    `6. **Create document** — Call \`create_para_doc\` with:`,
    `   - **Area**: Resources (default for external references)`,
    `   - **Tags**: reuse from step 5, add new ones only if necessary`,
    `   - **Source**: the original URL in frontmatter`,
    `   - **Content structure**:`,
    `     - \`## Source\` (original title + URL)`,
    `     - \`## Summary\` (2–5 paragraphs)`,
    `     - \`## Key Points\` (bulleted list)`,
    `     - \`## Relevance\` (why this matters or how to use it)`,
    `7. **Auto-link** — Auto-linking runs automatically after document creation.`,
    ``,
    `Proceed step by step.`,
  ].join("\n");
}
