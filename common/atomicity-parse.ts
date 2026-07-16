/**
 * JSON parsing utilities for atomicity validation sub-agent responses.
 *
 * LLMs often wrap JSON in markdown code fences despite explicit
 * instructions. These helpers handle common variations gracefully.
 *
 * @module common/atomicity-parse
 */

import type { AtomicityResult } from "./atomicity.js";

// ── JSON extraction ─────────────────────────────────────────────────

/**
 * Try to extract a JSON object or array from text.
 *
 * Tries parsing as-is first, then strips markdown code fences,
 * then searches for JSON object/array patterns in the text.
 *
 * @param text - Raw response text.
 * @returns Parsed JSON, or null if parsing fails.
 */
function tryParseJson(text: string): unknown {
  const trimmed = text.trim();

  // Try as-is first
  try {
    return JSON.parse(trimmed);
  } catch {
    // Fall through
  }

  // Strip markdown code fences
  const fenceMatch = trimmed.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```\s*$/);
  if (fenceMatch) {
    try {
      return JSON.parse(fenceMatch[1].trim());
    } catch {
      return null;
    }
  }

  // Find JSON object or array in text
  const jsonMatch = trimmed.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
  if (jsonMatch) {
    try {
      return JSON.parse(jsonMatch[1]);
    } catch {
      return null;
    }
  }

  return null;
}

// ── Result parsing ──────────────────────────────────────────────────

/**
 * Parse a single AtomicityResult from raw sub-agent response text.
 *
 * Validates that the JSON has the required `valid` and `message` fields
 * and optionally extracts `suggestedSplits`.
 *
 * @param text - Raw LLM response.
 * @returns Parsed result, or null if parsing fails.
 */
export function parseAtomicityResult(text: string): AtomicityResult | null {
  const parsed = tryParseJson(text);
  if (!parsed || typeof parsed !== "object") return null;

  const obj = parsed as Record<string, unknown>;
  if (typeof obj.valid !== "boolean" || typeof obj.message !== "string") return null;

  const result: AtomicityResult = {
    valid: obj.valid,
    message: obj.message,
  };

  if (Array.isArray(obj.suggestedSplits)) {
    result.suggestedSplits = obj.suggestedSplits.map((s: unknown) => {
      const split = s as Record<string, unknown>;
      return {
        title: typeof split.title === "string" ? split.title : "",
        content: typeof split.content === "string" ? split.content : "",
        tags: Array.isArray(split.tags) ? split.tags.map(String) : [],
        area: typeof split.area === "string" ? split.area : "Resources",
      };
    });
  }

  return result;
}

/**
 * Parse an array of AtomicityResults from raw sub-agent response text.
 *
 * Validates that the response is an array of the expected length and
 * that each entry has the required `valid` and `message` fields.
 *
 * @param text - Raw LLM response.
 * @param expectedLength - Expected number of results.
 * @returns Parsed results, or null if parsing fails.
 */
export function parseAtomicityResultsArray(
  text: string,
  expectedLength: number,
): AtomicityResult[] | null {
  const parsed = tryParseJson(text);
  if (!Array.isArray(parsed)) return null;
  if (parsed.length !== expectedLength) return null;

  const results: AtomicityResult[] = [];
  for (const item of parsed) {
    const obj = item as Record<string, unknown>;
    if (typeof obj.valid !== "boolean" || typeof obj.message !== "string") return null;

    const result: AtomicityResult = {
      valid: obj.valid,
      message: obj.message,
    };

    if (Array.isArray(obj.suggestedSplits)) {
      result.suggestedSplits = obj.suggestedSplits.map((s: unknown) => {
        const split = s as Record<string, unknown>;
        return {
          title: typeof split.title === "string" ? split.title : "",
          content: typeof split.content === "string" ? split.content : "",
          tags: Array.isArray(split.tags) ? split.tags.map(String) : [],
          area: typeof split.area === "string" ? split.area : "Resources",
        };
      });
    }

    results.push(result);
  }

  return results;
}
