/**
 * T5: parseGrouping is lenient about omitted empty arrays.
 *
 * @module tests/research-engine/parse-grouping.test
 */

import { describe, it, expect } from "vitest";

import { parseGrouping } from "../../extensions/research-engine/writeback.js";

describe("parseGrouping (T5)", () => {
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
});
