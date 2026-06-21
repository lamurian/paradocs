/**
 * Link Summarizer Extension — tool wrapper around common/fetchUrl.ts.
 *
 * Thin adapter: the fetch_url tool delegates to fetchUrlAsText and
 * formats the result with human-readable metadata. The batch_extract_failed
 * tool (Tavily batch for URLs that failed primary extraction) stays inline.
 *
 * @module extensions/link-summarizer/index
 */

import { Type } from "typebox";

import { addFailedUrl, extractBatch, hasPending } from "./tavily-extract.js";
import { fetchUrlAsText } from "../../common/fetchUrl.js";

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/** Constants for the batch_extract_failed tool formatting. */
const MAX_CONTENT_CHARS = 80_000;

function truncate(text: string): { body: string; truncated: boolean } {
  if (text.length <= MAX_CONTENT_CHARS) return { body: text, truncated: false };
  return {
    body:
      text.slice(0, MAX_CONTENT_CHARS) +
      `\n\n[... content truncated to ${MAX_CONTENT_CHARS.toLocaleString()} characters ...]`,
    truncated: true,
  };
}

function formatToolContent(
  title: string,
  url: string,
  body: string,
  engine: string,
  length: number,
  truncated: boolean,
): string {
  return (
    `📄 **${title}**\n🔗 ${url}\n` +
    `${engine} · ${length.toLocaleString()} chars` +
    (truncated ? ` (truncated to ${MAX_CONTENT_CHARS.toLocaleString()})` : "") +
    `\n\n━━━ Content ━━━\n\n${body}`
  );
}

/**
 * Format the shared fetchUrlAsText result into a tool response.
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
    addFailedUrl(url);
    return {
      content: [
        {
          type: "text" as const,
          text: `Obscura not available and HTTP fallback failed.\n\n🔗 ${url}\n⚠️ ${result.error}\n\nURL queued for Tavily batch extraction. Call \`batch_extract_failed\` to process all queued URLs.`,
        },
      ],
      details: { url, error: result.error, queuedForTavily: true },
      isError: true,
    };
  }

  const engineLabel =
    result.engine === "obscura-cdp"
      ? "Obscura headless browser"
      : result.engine === "http-fallback"
        ? "HTTP fallback (Obscura not available)"
        : result.engine === "pdftotext"
          ? "PDF extracted via pdftotext"
          : result.engine;

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

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "batch_extract_failed",
    label: "Batch Extract Failed URLs",
    description:
      "Process all URLs that failed Obscura and HTTP extraction via Tavily extract API. " +
      "Accumulated from previous fetch_url calls. Tavily handles JavaScript rendering, " +
      "making it suitable for SPAs and JS-heavy pages.",
    promptSnippet:
      "Batch-extract URLs that failed Obscura+HTTP extraction. Uses Tavily extract API.",
    parameters: Type.Object({
      format: Type.Optional(
        Type.Enum(
          { markdown: "markdown", text: "text" },
          { description: "Output format (default: markdown)" },
        ),
      ),
      extractDepth: Type.Optional(
        Type.Enum(
          { basic: "basic", advanced: "advanced" },
          { description: "Extraction depth (default: advanced)" },
        ),
      ),
    }),

    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      const { format, extractDepth } = params;

      if (!hasPending()) {
        return {
          content: [
            {
              type: "text" as const,
              text: "No URLs are pending batch extraction. All previous fetch_url calls succeeded or no URLs were fetched yet.",
            },
          ],
          details: { total: 0 },
        };
      }

      let results;
      try {
        results = await extractBatch({
          format: format as "markdown" | "text" | undefined,
          extractDepth: extractDepth as "basic" | "advanced" | undefined,
        });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text" as const, text: `Tavily batch extraction failed: ${msg}` }],
          details: { error: msg },
          isError: true,
        };
      }

      const succeeded = results.filter((r) => r.success);
      const failed = results.filter((r) => !r.success);

      const lines: string[] = [];
      lines.push(
        `**Tavily batch extract** — ${results.length} URL${results.length === 1 ? "" : "s"}`,
      );
      if (succeeded.length) {
        lines.push(`**Succeeded:** ${succeeded.length}`);
        for (const r of succeeded) {
          const title = r.title ?? "(no title)";
          const { body, truncated } = truncate(r.markdown);
          lines.push("");
          lines.push(
            formatToolContent(title, r.url, body, "Tavily extract", r.markdown.length, truncated),
          );
        }
      }
      if (failed.length) {
        lines.push(`**Failed:** ${failed.length}`);
        for (const r of failed) {
          lines.push(`\n🔗 ${r.url}\n⚠️ ${r.error ?? "Unknown error"}`);
        }
      }

      return {
        content: [{ type: "text" as const, text: lines.join("\n") }],
        details: {
          total: results.length,
          succeeded: succeeded.length,
          failed: failed.length,
          results: results.map((r) => ({
            url: r.url,
            title: r.title,
            success: r.success,
            error: r.error,
            extractedLength: r.success ? r.markdown.length : undefined,
          })),
        },
      };
    },
  });

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
