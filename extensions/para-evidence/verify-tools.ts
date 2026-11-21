/**
 * verify_source — tool wrapper around common/verify-source.ts.
 *
 * Thin adapter: parses params via typebox, delegates to the shared
 * verifySource function with the global fetch, and renders a compact
 * text summary plus structured details.
 *
 * @module extensions/para-evidence/verify-tools
 */

import { Type } from "typebox";

import { loadEvidencePack } from "../../common/evidence-cache.ts";
import { fetchUrlAsText } from "../../common/fetchUrl.ts";
import { verifyQuote } from "../../common/verify-quote.ts";
import { verifySource } from "../../common/verify-source.ts";

import type { VerifyQuoteResult } from "../../common/verify-quote.ts";
import type { VerifySourceResult } from "../../common/verify-source.ts";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/**
 * Render a verification result as plain text.
 *
 * @param result - Verification result to render.
 * @returns Human-readable summary lines.
 */
export function formatVerification(result: VerifySourceResult): string {
  const lines = [
    `doi: ${result.doi ?? "(none)"}`,
    `trust: ${result.trust}`,
    `title: ${result.title ?? "(unknown)"}`,
    `container: ${result.container ?? "(unknown)"}`,
    `published: ${result.published ?? "(unknown)"}`,
    `retracted: ${result.retracted === null ? "unknown" : result.retracted ? "yes" : "no"}`,
    `canonical: ${result.canonicalUrl ?? "(unknown)"}`,
    `reachable: ${result.reachable === null ? "unknown" : result.reachable ? "yes" : "no"}`,
    `http status: ${result.httpStatus ?? "n/a"}`,
    `wayback: ${result.waybackUrl ?? "(none)"}`,
    `checks: reachability=${result.checks.reachability} crossref=${result.checks.crossref} wayback=${result.checks.wayback}`,
  ];
  return lines.join("\n");
}

/**
 * Render a quote verification result as plain text.
 *
 * @param result - Verification result to render.
 * @returns Human-readable summary lines.
 */
export function formatQuoteVerification(result: VerifyQuoteResult): string {
  return [
    `match: ${result.match}`,
    `score: ${result.score}`,
    `excerpt: ${result.excerpt ?? "(none)"}`,
  ].join("\n");
}

/**
 * Optional dependencies for {@link registerVerifyQuoteTool}; tests inject a
 * deterministic URL fetcher here.
 */
export interface VerifyQuoteToolDeps {
  fetchUrlAsText?: typeof fetchUrlAsText;
}

/**
 * Register the verify_quote tool.
 *
 * Reads the source text from an evidence pack when `evidenceId` is given,
 * otherwise fetches `url` as text, then delegates to {@link verifyQuote}.
 *
 * @param pi - The pi extension API.
 * @param deps - Optional injected dependencies (defaults to real fetch).
 */
export function registerVerifyQuoteTool(pi: ExtensionAPI, deps: VerifyQuoteToolDeps = {}): void {
  const fetchText = deps.fetchUrlAsText ?? fetchUrlAsText;

  pi.registerTool({
    name: "verify_quote",
    label: "Verify Quote",
    description:
      "Deterministically check whether a quote appears in a source. Reads the " +
      "source from an evidence pack (evidenceId) or fetches a URL, normalizes " +
      "both, and reports exact, fuzzy (above threshold) or not-found with the " +
      "best excerpt and score.",
    promptSnippet: "Verify a quote against an evidence source or URL (exact/fuzzy/not-found)",
    parameters: Type.Object({
      quote: Type.String({ description: "Quote text to locate in the source." }),
      url: Type.Optional(Type.String({ description: "URL to fetch when no evidenceId is given." })),
      evidenceId: Type.Optional(
        Type.String({ description: "Evidence pack id, e.g. ev-abc123-1a2b." }),
      ),
      sourceIndex: Type.Optional(
        Type.Number({ description: "Zero-based source index in the pack (default 0)." }),
      ),
    }),

    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      let sourceText: string;

      if (params.evidenceId !== undefined) {
        const pack = loadEvidencePack(ctx.cwd, params.evidenceId);
        if (!pack) {
          return {
            isError: true,
            content: [
              {
                type: "text" as const,
                text: `Evidence pack "${params.evidenceId}" not found.`,
              },
            ],
            details: { evidenceId: params.evidenceId, found: false },
          };
        }

        const sourceIndex = params.sourceIndex ?? 0;
        const source = pack.sources[sourceIndex];
        if (!source) {
          return {
            isError: true,
            content: [
              {
                type: "text" as const,
                text: `Evidence pack "${params.evidenceId}" has no source at index ${sourceIndex}.`,
              },
            ],
            details: { evidenceId: params.evidenceId, sourceIndex, found: false },
          };
        }
        if (source.content === undefined) {
          return {
            isError: true,
            content: [
              {
                type: "text" as const,
                text: `Evidence pack "${params.evidenceId}" source ${sourceIndex} has no stored content.`,
              },
            ],
            details: { evidenceId: params.evidenceId, sourceIndex, found: false },
          };
        }
        sourceText = source.content;
      } else if (params.url !== undefined) {
        const fetched = signal ? await fetchText(params.url, signal) : await fetchText(params.url);
        if ("error" in fetched) {
          return {
            isError: true,
            content: [
              { type: "text" as const, text: `Failed to fetch ${params.url}: ${fetched.error}` },
            ],
            details: { url: params.url, error: fetched.error },
          };
        }
        sourceText = fetched.content;
      } else {
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text: "verify_quote requires either an evidenceId or a url.",
            },
          ],
          details: { quote: params.quote, error: "missing-source" },
        };
      }

      const result = verifyQuote(params.quote, sourceText);
      return {
        content: [{ type: "text" as const, text: formatQuoteVerification(result) }],
        details: { ...result },
      };
    },
  });
}

/**
 * Register the verify_source tool.
 *
 * Also registers verify_quote so the para-evidence module exposes both
 * deterministic verification tools through its single entry point.
 *
 * @param pi - The pi extension API.
 * @param deps - Optional injected dependencies forwarded to verify_quote.
 */
export function registerVerifySourceTool(pi: ExtensionAPI, deps: VerifyQuoteToolDeps = {}): void {
  registerVerifyQuoteTool(pi, deps);

  pi.registerTool({
    name: "verify_source",
    label: "Verify Source",
    description:
      "Deterministically verify a source by URL and/or DOI: Crossref metadata " +
      "(title, container, published date, retraction), URL reachability and " +
      "canonical final URL, closest Wayback snapshot, and a trust class. " +
      "Each check is independent; failures report 'unknown' instead of throwing.",
    promptSnippet:
      "Verify a source (DOI/URL): Crossref metadata, reachability, Wayback snapshot, trust",
    parameters: Type.Object({
      url: Type.Optional(Type.String({ description: "URL to verify (reachability, Wayback)." })),
      doi: Type.Optional(Type.String({ description: "DOI to resolve via Crossref." })),
    }),

    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      const result = await verifySource(params, { fetch, now: () => new Date() });
      return {
        content: [{ type: "text" as const, text: formatVerification(result) }],
        details: { ...result },
      };
    },
  });
}
