/**
 * T6: parsePlan supersedes the T4 single-call parseGrouping assertions.
 *
 * The grouping mega-call is gone: the plan response is tiny structured
 * JSON ({plan: [{title, tags, area, sources, keyIdea}], outdated: [...]}).
 * Parsing stays lenient — hallucinated tool-call markup is stripped,
 * entries are validated individually (malformed ones dropped, null only
 * when zero valid remain), and optional entry fields get schema defaults.
 *
 * @module tests/research-engine/parse-grouping
 */

import { describe, it, expect } from "vitest";

import { parsePlan } from "../../extensions/research-engine/writeback-plan.js";

describe("parsePlan (T6)", () => {
  const entry = {
    title: "N",
    tags: ["t"],
    area: "Areas",
    sources: ["https://a.example/1"],
    keyIdea: "k",
  };

  it("keeps plan and outdated arrays when present", () => {
    const o = { path: "Resources/o.md", reason: "r", content: "c" };
    expect(parsePlan(JSON.stringify({ plan: [entry], outdated: [o] }))).toEqual({
      plan: [entry],
      outdated: [o],
    });
  });

  it("defaults missing outdated to [] and fills optional entry fields", () => {
    const r = parsePlan(
      JSON.stringify({ plan: [{ title: "Bare", sources: ["https://b.example/2"] }] }),
    );
    expect(r).toEqual({
      plan: [
        {
          title: "Bare",
          tags: [],
          area: "Resources",
          sources: ["https://b.example/2"],
          keyIdea: "",
        },
      ],
      outdated: [],
    });
  });

  it("returns null when plan is missing or not an array", () => {
    expect(parsePlan("{}")).toBeNull();
    expect(parsePlan('{"plan":"nope"}')).toBeNull();
    expect(parsePlan("not json")).toBeNull();
  });

  it("parses a tool-markup-prefixed response with a valid plan array", () => {
    const markup =
      '<function_calls>\n<invoke name="list_directory" path="/kb">\n</invoke>\n</function_calls>';
    const text = `${markup}\n${JSON.stringify({ plan: [entry] })}`;
    expect(parsePlan(text)).toEqual({ plan: [entry], outdated: [] });
  });

  it("parses a fenced tool-call block followed by a valid plan object", () => {
    const text =
      '```json\n{"type": "tool_use", "name": "list_directory", "input": {"path": "/kb"}}\n```\n\n' +
      JSON.stringify({ plan: [entry] });
    expect(parsePlan(text)).toEqual({ plan: [entry], outdated: [] });
  });

  it("yields only valid entries when the plan mixes malformed and valid entries", () => {
    const response = {
      plan: [
        entry,
        { title: "No sources" },
        { title: "", sources: ["https://x.example/1"] },
        { sources: ["https://y.example/1"] },
        { title: "Bad urls", sources: ["ok", 42] },
        null,
        "junk",
        42,
      ],
    };
    expect(parsePlan(JSON.stringify(response))).toEqual({ plan: [entry], outdated: [] });
  });

  it("returns null when every plan entry is malformed", () => {
    const response = { plan: [{ title: 1 }, { sources: [] }, {}, null, "junk"] };
    expect(parsePlan(JSON.stringify(response))).toBeNull();
  });
});
