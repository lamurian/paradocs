/**
 * Link Summarizer Extension — tool wrapper around common/fetchUrl.ts.
 *
 * Thin adapter: the fetch_url tool delegates to fetchUrlAsText and
 * formats the result with human-readable metadata.
 *
 * @module extensions/link-summarizer/index
 */

import { Type } from "typebox";

import { fetchUrlAsText } from "../../common/fetchUrl.ts";

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/** Human-readable labels for the extraction engines. */
const ENGINE_LABELS: Record<string, string> = {
  "obscura-cdp": "Obscura headless browser",
  "http-fallback": "HTTP fallback (Obscura not available)",
  pdftotext: "PDF extracted via pdftotext",
  "tavily-extract": "Tavily extract",
};

/**
 * Format the shared fetchUrlAsText result into a tool response.
 *
 * @param result - Successful extraction or an error object.
 * @param url    - The URL that was fetched.
 * @returns Tool content, details, and an isError flag on failure.
 */
function formatToolResponse(
  result: { title: string; content: string; engine: string } | { error: string },
  url: string,
): {
  content: Array<{ type: "text"; text: string }>;
  details: Record<string, unknown>;
  isError?: boolean;
} {
  if ("error" in result) {
    return {
      content: [
        {
          type: "text" as const,
          text: `Obscura not available and HTTP fallback failed.\n\n🔗 ${url}\n⚠️ ${result.error}`,
        },
      ],
      details: { url, error: result.error },
      isError: true,
    };
  }

  const engineLabel = ENGINE_LABELS[result.engine] ?? result.engine;

  return {
    content: [
      {
        type: "text" as const,
        text: `📄 **${result.title}**\n🔗 ${url}\n${engineLabel} · ${result.content.length.toLocaleString()} chars\n\n━━━ Content ━━━\n\n${result.content}`,
      },
    ],
    details: {
      engine: result.engine,
      title: result.title,
      url,
      extractedLength: result.content.length,
    },
  };
}

/** Register the fetch_url tool with pi. */
export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "fetch_url",
    label: "Fetch URL",
    description: "Fetch a URL and get its content as Markdown.",
    promptSnippet: "Fetch a URL and get its content as Markdown",
    parameters: Type.Object({
      url: Type.String({ description: "The URL to fetch and extract content from" }),
    }),

    async execute(_toolCallId, params, signal, _onUpdate, _ctx) {
      const { url } = params;
      const result = await fetchUrlAsText(url, signal);
      return formatToolResponse(result, url);
    },
  });
}
