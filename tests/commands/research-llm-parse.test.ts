/**
 * Tests for parseSufficiencyResponse — robust JSON extraction for
 * the sufficiency evaluation LLM call.
 *
 * @module tests/commands/research-llm-parse
 */

import { describe, it, expect } from "vitest";

import { parseSufficiencyResponse } from "../../extensions/commands/research-llm.js";

describe("parseSufficiencyResponse", () => {
  it("should parse clean bare JSON", () => {
    const text = '{"sufficient": false, "rationale": "Not covered.", "answer": ""}';
    const result = parseSufficiencyResponse(text);
    expect(result).toEqual({ sufficient: false, rationale: "Not covered.", answer: "" });
  });

  it("should parse JSON wrapped in markdown fences", () => {
    const text = '```json\n{"sufficient": true, "rationale": "Covered.", "answer": "Yes."}\n```';
    const result = parseSufficiencyResponse(text);
    expect(result).toEqual({ sufficient: true, rationale: "Covered.", answer: "Yes." });
  });

  it("should parse JSON with leading explanatory text", () => {
    const text =
      'Based on the documents, here is my analysis:\n{"sufficient": false, "rationale": "Gaps.", "answer": ""}';
    const result = parseSufficiencyResponse(text);
    expect(result).toEqual({ sufficient: false, rationale: "Gaps.", answer: "" });
  });

  it("should parse JSON with trailing commas", () => {
    const text = '{"sufficient": false, "rationale": "test",}';
    const result = parseSufficiencyResponse(text);
    expect(result).toEqual({ sufficient: false, rationale: "test" });
  });

  it("should return null for completely unparseable text", () => {
    expect(parseSufficiencyResponse("This is not JSON at all.")).toBeNull();
  });

  it("should return null when sufficient field is missing", () => {
    const text = '{"rationale": "Missing sufficient field.", "answer": "test"}';
    expect(parseSufficiencyResponse(text)).toBeNull();
  });

  it("should return null when sufficient is a string instead of boolean", () => {
    const text = '{"sufficient": "yes", "rationale": "test", "answer": ""}';
    expect(parseSufficiencyResponse(text)).toBeNull();
  });

  it("should return null when sufficient is a number", () => {
    const text = '{"sufficient": 1, "rationale": "test", "answer": ""}';
    expect(parseSufficiencyResponse(text)).toBeNull();
  });

  it("should parse JSON with additional optional fields", () => {
    const text =
      '{"sufficient": true, "rationale": "Covered.", "answer": "Yes.", "createNote": true, "noteTitle": "Title"}';
    const result = parseSufficiencyResponse(text);
    expect(result).toEqual({
      sufficient: true,
      rationale: "Covered.",
      answer: "Yes.",
      createNote: true,
      noteTitle: "Title",
    });
  });

  it("should parse JSON with notes array", () => {
    const text =
      '{"sufficient": true, "rationale": "Synthesis.", "answer": "Answer.", "createNote": true, "notes": [{"title": "A", "content": "B", "tags": ["c"]}]}';
    const result = parseSufficiencyResponse(text);
    expect(result).toEqual({
      sufficient: true,
      rationale: "Synthesis.",
      answer: "Answer.",
      createNote: true,
      notes: [{ title: "A", content: "B", tags: ["c"] }],
    });
  });
});
