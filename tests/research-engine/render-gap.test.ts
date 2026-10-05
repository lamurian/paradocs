/**
 * Gap tests for render.ts uncovered branches: renderAnswerBody with an
 * empty synthesis but collected summaries / KB docs + fetches, and
 * renderWritebackLines with undefined and empty write-back outcomes.
 * Pure renderers — no I/O, no mocks.
 *
 * @module tests/research-engine/render-gap
 */

import { describe, it, expect } from "vitest";

import { renderAnswerBody, renderWritebackLines } from "../../extensions/research-engine/render.js";

const SUMMARY = { url: "https://r.example/1", title: "R", summary: "Rendered summary" };

describe("renderAnswerBody — fallback branches", () => {
  it("appends collected summaries before the unavailable note when synthesis is empty", () => {
    const body = renderAnswerBody({
      synthesis: "",
      synthesisError: undefined,
      summaries: [SUMMARY],
      kbDocs: [],
      fetches: [],
    } as never);

    expect(body).toContain("- https://r.example/1 (R): Rendered summary");
    expect(body.endsWith("_(synthesis unavailable: no sources collected)_")).toBe(true);
  });

  it("surfaces the synthesis error in the note line", () => {
    const body = renderAnswerBody({
      synthesis: "  ",
      synthesisError: "synthesis down",
      summaries: [SUMMARY],
      kbDocs: [],
      fetches: [],
    } as never);

    expect(body).toContain("_(synthesis unavailable: synthesis down)_");
  });

  it("lists KB docs and fetched sources when no summaries exist", () => {
    const body = renderAnswerBody({
      synthesis: undefined,
      synthesisError: undefined,
      summaries: [],
      kbDocs: [{ title: "KB Doc", path: "Resources/kb.md" }],
      fetches: [
        { url: "https://f.example/a", title: "F", ok: true },
        { url: "https://f.example/dead", ok: false },
      ],
    } as never);

    expect(body).toContain("- KB: KB Doc (Resources/kb.md)");
    expect(body).toContain("- https://f.example/a (F)");
    expect(body).not.toContain("https://f.example/dead");
  });
});

describe("renderWritebackLines — empty branches", () => {
  it("reports write-back as not run when undefined", () => {
    expect(renderWritebackLines(undefined)).toEqual(["(write-back not run)"]);
  });

  it("reports no changes when all lists are empty", () => {
    expect(renderWritebackLines({ created: [], updated: [], skipped: [] })).toEqual([
      "(no changes)",
    ]);
  });

  it("renders one line per created, updated, and skipped entry", () => {
    expect(
      renderWritebackLines({
        created: ["Resources/a.md"],
        updated: ["Resources/b.md"],
        skipped: ["draft: /tmp/d.md"],
      }),
    ).toEqual(["created: Resources/a.md", "updated: Resources/b.md", "skipped: draft: /tmp/d.md"]);
  });
});
