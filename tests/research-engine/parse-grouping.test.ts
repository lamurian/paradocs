/**
 * T4: parseGrouping is lenient - strips hallucinated tool-call markup,
 * validates note entries individually, and defaults missing outdated to [].
 *
 * @module tests/research-engine/parse-grouping
 */

import { describe, it, expect } from "vitest";

import { parseGrouping } from "../../extensions/research-engine/writeback.js";

describe("parseGrouping (T4)", () => {
  it("defaults missing outdated to []", () => {
    const n = { title: "N", content: "C", tags: ["t"] };
    expect(parseGrouping(JSON.stringify({ notes: [n] }))).toEqual({ notes: [n], outdated: [] });
  });

  it("keeps both arrays unchanged when present", () => {
    const n = { title: "N", content: "C", tags: [] };
    const o = { path: "Resources/o.md", reason: "r", content: "c" };
    expect(parseGrouping(JSON.stringify({ notes: [n], outdated: [o] }))).toEqual({
      notes: [n],
      outdated: [o],
    });
  });

  it("returns null when notes is missing or not an array", () => {
    expect(parseGrouping("{}")).toBeNull();
    expect(parseGrouping('{"notes":"nope"}')).toBeNull();
    expect(parseGrouping("not json")).toBeNull();
  });

  it("parses a tool-markup-prefixed response with a valid notes array", () => {
    const n = { title: "N", content: "C", tags: ["t"] };
    const markup =
      '<function_calls>\n<invoke name="list_directory" path="/kb">\n</invoke>\n</function_calls>';
    const text = `${markup}\n${JSON.stringify({ notes: [n] })}`;
    expect(parseGrouping(text)).toEqual({ notes: [n], outdated: [] });
  });

  it("parses a fenced tool-call block followed by a valid notes object", () => {
    const n = { title: "N", content: "C" };
    const text =
      '```json\n{"type": "tool_use", "name": "list_directory", "input": {"path": "/kb"}}\n```\n\n' +
      JSON.stringify({ notes: [n] });
    expect(parseGrouping(text)).toEqual({ notes: [n], outdated: [] });
  });

  it("yields only valid entries when notes mix malformed and valid entries", () => {
    const good = { title: "Good", content: "Body", tags: ["g"] };
    const response = {
      notes: [good, { title: "No content" }, { content: "No title" }, null, "junk", 42],
    };
    expect(parseGrouping(JSON.stringify(response))).toEqual({ notes: [good], outdated: [] });
  });

  it("returns null when every note entry is malformed", () => {
    const response = { notes: [{ title: 1 }, { content: 2 }, {}, null, "junk"] };
    expect(parseGrouping(JSON.stringify(response))).toBeNull();
  });
});
