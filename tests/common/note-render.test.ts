import { describe, expect, it } from "vitest";

import { renderNote } from "../../common/note-render.ts";

import type { NoteBlocks } from "../../common/note-render.ts";

const NOW = new Date("2026-06-18T12:00:00.000Z");

function baseBlocks(overrides: Partial<NoteBlocks> = {}): NoteBlocks {
  return {
    title: "Test Note",
    description: "A deterministic note",
    tags: ["alpha", "beta"],
    area: "Resources",
    summary: [],
    keyPoints: [],
    ...overrides,
  };
}

describe("renderNote", () => {
  it("counts wrapped summary and key point lines and charges table rows ceil(len/width)", () => {
    const result = renderNote(
      baseBlocks({
        summary: ["This is a short paragraph.", "| A | B |", "| C | D |"],
        keyPoints: ["First point with words.", "See @smith2020 and @jones2021."],
      }),
      { wrapWidth: 20, now: NOW },
    );

    // Summary paragraph: 2 lines, table rows: 1 + 1, key points: 2 + 2.
    expect(result.contentLines).toBe(8);
  });

  it("emits expanded frontmatter, fixed headings and Sources last", () => {
    const result = renderNote(
      baseBlocks({
        summary: ["Summary cites @smith2020."],
        keyPoints: ["Key point cites @jones2021 and @smith2020."],
        reviewed: "2026-05-01",
        reviewInterval: 30,
      }),
      { wrapWidth: 80, now: NOW },
    );

    expect(result.markdown).toContain("title: Test Note");
    expect(result.markdown).toContain("description: A deterministic note");
    expect(result.markdown).toContain("author: pi");
    expect(result.markdown).toContain("editor: lam");
    expect(result.markdown).toContain(`date: ${NOW.toISOString()}`);
    expect(result.markdown).toContain("tags:\n  - alpha\n  - beta");
    expect(result.markdown).toContain("reviewed: 2026-05-01");
    expect(result.markdown).toContain("review_interval: 30");

    const summaryIdx = result.markdown.indexOf("## Summary");
    const keyIdx = result.markdown.indexOf("## Key Points");
    const sourcesIdx = result.markdown.indexOf("## Sources");
    expect(summaryIdx).toBeGreaterThan(-1);
    expect(keyIdx).toBeGreaterThan(summaryIdx);
    expect(sourcesIdx).toBeGreaterThan(keyIdx);

    expect(result.markdown).toContain("## Sources\n\n- @smith2020\n- @jones2021\n");
    expect(result.citekeys).toEqual(["smith2020", "jones2021"]);
  });

  it("groups consecutive table rows verbatim without blank lines", () => {
    const result = renderNote(baseBlocks({ summary: ["| A | B |", "| C | D |"] }), {
      wrapWidth: 80,
      now: NOW,
    });

    expect(result.markdown).toContain("## Summary\n\n| A | B |\n| C | D |\n");
  });

  it("omits Sources when no citekeys are present", () => {
    const result = renderNote(baseBlocks({ keyPoints: ["Plain point."] }), {
      wrapWidth: 80,
      now: NOW,
    });

    expect(result.markdown).not.toContain("## Sources");
    expect(result.citekeys).toEqual([]);
  });
});
