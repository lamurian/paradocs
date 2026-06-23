/**
 * Tests for the JSON extraction utility.
 *
 * @module tests/common/extractJson.test
 */

import { describe, it, expect } from "vitest";

import { extractJson } from "../../common/extractJson.js";

describe("extractJson", () => {
  it("should parse clean JSON as-is", () => {
    const result = extractJson('{"sufficient": false, "rationale": "test"}');
    expect(result).toEqual({ sufficient: false, rationale: "test" });
  });

  it("should parse JSON array", () => {
    const result = extractJson('[{"title": "Note One"}]');
    expect(result).toEqual([{ title: "Note One" }]);
  });

  it("should strip markdown code fences with json label", () => {
    const result = extractJson('```json\n{"sufficient": true}\n```');
    expect(result).toEqual({ sufficient: true });
  });

  it("should strip markdown code fences without label", () => {
    const result = extractJson('```\n{"sufficient": false}\n```');
    expect(result).toEqual({ sufficient: false });
  });

  it("should strip leading explanatory text before JSON", () => {
    const result = extractJson(
      'Here is the JSON you requested:\n{"answer": "test"}\nLet me know if you need more.',
    );
    expect(result).toEqual({ answer: "test" });
  });

  it("should strip trailing text after JSON", () => {
    const result = extractJson('{"answer": "test"}\n\nHope this helps!');
    expect(result).toEqual({ answer: "test" });
  });

  it("should handle trailing commas in objects", () => {
    const text = '{"sufficient": false, "rationale": "test",}';
    const result = extractJson(text);
    expect(result).toEqual({ sufficient: false, rationale: "test" });
  });

  it("should handle trailing commas in arrays", () => {
    const text = '{"items": [1, 2, 3,]}';
    const result = extractJson(text);
    expect(result).toEqual({ items: [1, 2, 3] });
  });

  it("should extract JSON from mixed text with code fences and explanation", () => {
    const text =
      'Let me analyse this.\n\n```json\n{"sufficient": false,\n"rationale": "Not enough coverage."}\n```\n\nI hope this helps!';
    const result = extractJson(text);
    expect(result).toEqual({ sufficient: false, rationale: "Not enough coverage." });
  });

  it("should return null for empty string", () => {
    expect(extractJson("")).toBeNull();
  });

  it("should return null for whitespace-only string", () => {
    expect(extractJson("   \n\n  ")).toBeNull();
  });

  it("should return null for unparseable text with no JSON structure", () => {
    expect(extractJson("This is just plain text without any JSON.")).toBeNull();
  });

  it("should return null for unparseable text with markdown but no JSON", () => {
    expect(extractJson("```\nThis is a code block without JSON.\n```")).toBeNull();
  });
});
