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

import { verifySource } from "../../common/verify-source.ts";

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
 * Register the verify_source tool.
 *
 * @param pi - The pi extension API.
 */
export function registerVerifySourceTool(pi: ExtensionAPI): void {
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
