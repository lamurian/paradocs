import { describe, it, expect } from "vitest";

import { extractCitekeys } from "../../common/citekeys.ts";

describe("extractCitekeys", () => {
  it("returns citekeys in first-seen order without duplicates", () => {
    const text = "See @smith2020 and @jones2021, then @smith2020 again.";
    expect(extractCitekeys(text)).toEqual(["smith2020", "jones2021"]);
  });

  it("accepts line start, whitespace, [, ; and ( prefixes", () => {
    expect(extractCitekeys("@lineStart")).toEqual(["lineStart"]);
    expect(extractCitekeys("word @spacePrefix")).toEqual(["spacePrefix"]);
    expect(extractCitekeys("[see @bracket]")).toEqual(["bracket"]);
    expect(extractCitekeys("[@bracketKey]")).toEqual(["bracketKey"]);
    expect(extractCitekeys("a; @semicolon")).toEqual(["semicolon"]);
    expect(extractCitekeys("(@paren)")).toEqual(["paren"]);
  });

  it("does not match email addresses", () => {
    expect(extractCitekeys("contact a@b.com for details")).toEqual([]);
    expect(extractCitekeys("a@b.com")).toEqual([]);
  });

  it("strips trailing punctuation from citekeys", () => {
    expect(extractCitekeys("As shown @doe2020.")).toEqual(["doe2020"]);
    expect(extractCitekeys("As shown @doe2020, and @roe2021;")).toEqual(["doe2020", "roe2021"]);
    expect(extractCitekeys("@key:")).toEqual(["key"]);
  });

  it("supports punctuation inside keys", () => {
    expect(extractCitekeys("@doe:2020/a-b#c")).toEqual(["doe:2020/a-b#c"]);
    expect(extractCitekeys("@a+b?c~d")).toEqual(["a+b?c~d"]);
  });

  it("returns an empty array when no citekeys are present", () => {
    expect(extractCitekeys("plain text without citations")).toEqual([]);
    expect(extractCitekeys("")).toEqual([]);
  });
});
