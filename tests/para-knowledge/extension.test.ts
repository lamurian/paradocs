/**
 * Tests for the para-knowledge extension entry point.
 *
 * Verifies that the extension registers exactly the read-only knowledge
 * tools: search_para_docs, list_para_tags and resolve_citation.
 */

import { describe, it, expect } from "vitest";

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

describe("para-knowledge extension registration", () => {
  it("registers exactly search_para_docs, list_para_tags and resolve_citation", async () => {
    const { default: paraKnowledge } = await import("../../extensions/para-knowledge/index.ts");

    const registered: string[] = [];
    const fakePi = {
      registerTool: (tool: { name: string }) => {
        registered.push(tool.name);
      },
    } as unknown as ExtensionAPI;

    paraKnowledge(fakePi);

    expect(registered).toEqual(["search_para_docs", "list_para_tags", "resolve_citation"]);
  });
});
