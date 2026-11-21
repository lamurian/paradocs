import { describe, expect, it } from "vitest";

import { wrapText } from "../../common/text-wrap.ts";

describe("wrapText", () => {
  it("breaks on word boundaries within the width", () => {
    expect(wrapText("one two three four", 10)).toEqual(["one two", "three four"]);
  });

  it("applies the first and continuation prefixes", () => {
    expect(wrapText("one two three four", 10, { firstPrefix: "- ", restPrefix: "  " })).toEqual([
      "- one two",
      "  three",
      "  four",
    ]);
  });

  it("counts prefixes against the width", () => {
    expect(wrapText("aaaa bbbb cccc", 7, { firstPrefix: "- ", restPrefix: "  " })).toEqual([
      "- aaaa",
      "  bbbb",
      "  cccc",
    ]);
  });

  it("keeps a token longer than the width on its own line", () => {
    expect(wrapText("short https://example.com/very/long/path end", 12)).toEqual([
      "short",
      "https://example.com/very/long/path",
      "end",
    ]);
  });

  it("returns an empty array for blank input", () => {
    expect(wrapText("   ", 10)).toEqual([]);
    expect(wrapText("", 10)).toEqual([]);
  });
});
