/**
 * JSON extraction utility for LLM responses.
 *
 * LLMs often wrap JSON in markdown code fences, add explanatory text, or
 * produce trailing commas. This utility tries multiple strategies to extract
 * valid JSON from raw text output.
 *
 * @module common/extractJson
 */

/**
 * Attempt to extract and parse JSON from LLM output text.
 *
 * Strategies tried in order:
 * 1. Direct parse of trimmed input
 * 2. Strip markdown code fences (```json / ```) then parse
 * 3. Extract first `{...}` or `[...]` block from text then parse
 * 4. Attempt to fix trailing commas by replacing before parsing
 *
 * @param text - Raw text output from the LLM.
 * @returns Parsed JSON value, or null if no valid JSON could be extracted.
 */
export function extractJson(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) return null;

  // Strategy 1: Direct parse
  const direct = tryParse(trimmed);
  if (direct !== null) return direct;

  // Strategy 2: Strip markdown code fences
  const noFences = trimmed.replace(/^```(?:json)?\s*\n?/i, "").replace(/\n?```\s*$/i, "");
  if (noFences !== trimmed) {
    const parsed = tryParse(noFences);
    if (parsed !== null) return parsed;
  }

  // Strategy 3: Extract JSON object or array block from text
  const jsonBlock = extractJsonBlock(noFences);
  if (jsonBlock !== null) return jsonBlock;

  return null;
}

/**
 * Try parsing a string as JSON, optionally with trailing comma fix.
 *
 * @param str - The string to parse.
 * @returns Parsed value, or null.
 */
function tryParse(str: string): unknown {
  const trimmed = str.trim();
  if (!trimmed) return null;

  try {
    return JSON.parse(trimmed);
  } catch {
    // Try with trailing comma fix
    const fixed = fixTrailingCommas(trimmed);
    if (fixed !== trimmed) {
      try {
        return JSON.parse(fixed);
      } catch {
        return null;
      }
    }
    return null;
  }
}

/**
 * Fix trailing commas in JSON strings.
 *
 * Replaces `,}` with `}` and `,]` with `]` to handle common LLM output quirk.
 *
 * @param str - JSON string that may contain trailing commas.
 * @returns String with trailing commas removed.
 */
function fixTrailingCommas(str: string): string {
  return str.replace(/,\s*}/g, "}").replace(/,\s*\]/g, "]");
}

/**
 * Extract the first JSON object `{...}` or array `[...]` block from text.
 *
 * Finds the first `{` or `[` and the matching closing `}` or `]`, and attempts
 * to parse the substring. Walks through nested braces/brackets correctly.
 *
 * @param text - Text potentially containing a JSON block.
 * @returns Parsed value, or null.
 */
function extractJsonBlock(text: string): unknown {
  // Try extracting a JSON object first, then array
  const objectResult = extractBracketedBlock(text, "{", "}");
  if (objectResult !== null) return objectResult;

  const arrayResult = extractBracketedBlock(text, "[", "]");
  if (arrayResult !== null) return arrayResult;

  return null;
}

/**
 * Extract a bracketed block starting with openChar and ending with closeChar.
 *
 * Handles nested brackets correctly by counting depth.
 *
 * @param text - Text containing a bracketed block.
 * @param openChar - Opening bracket character.
 * @param closeChar - Closing bracket character.
 * @returns Parsed value, or null.
 */
function extractBracketedBlock(text: string, openChar: string, closeChar: string): unknown {
  const startIdx = text.indexOf(openChar);
  if (startIdx === -1) return null;

  let depth = 0;
  let inString = false;
  for (let i = startIdx; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"' && i > 0 && text[i - 1] !== "\\") {
      inString = !inString;
    }
    if (!inString) {
      if (ch === openChar) depth++;
      if (ch === closeChar) depth--;
      if (depth === 0) {
        const candidate = text.slice(startIdx, i + 1);
        return tryParse(candidate);
      }
    }
  }
  return null;
}
