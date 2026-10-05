/**
 * Tests that the research-engine tool_call hook is fully removed.
 *
 * The PI_RESEARCH_ENGINE=1 hook and hasKbSearch were removed with the
 * subagent collapse: lean subagents cannot call blocked tools, so the
 * KB-first gate is obsolete. These tests pin the removal (M2).
 *
 * @module tests/research-engine/tool-call-hook.test
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, it, expect } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const INDEX_TS = resolve(HERE, "../../extensions/research-engine/index.ts");

describe("research engine tool_call hook removal", () => {
  it("index.ts no longer references PI_RESEARCH_ENGINE or the hook", () => {
    const source = readFileSync(INDEX_TS, "utf-8");
    expect(source).not.toContain("PI_RESEARCH_ENGINE");
    expect(source).not.toContain("createToolCallHook");
    expect(source).not.toContain("hasKbSearch");
  });

  it("no extension source registers the KB-first tool_call gate", async () => {
    const { readdirSync } = await import("node:fs");
    const extRoot = resolve(HERE, "../../extensions");
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const p = resolve(dir, entry.name);
        if (entry.isDirectory()) walk(p);
        else if (entry.name.endsWith(".ts")) {
          const src = readFileSync(p, "utf-8");
          if (src.includes("PI_RESEARCH_ENGINE")) offenders.push(p);
        }
      }
    };
    walk(extRoot);
    expect(offenders).toEqual([]);
  });
});
