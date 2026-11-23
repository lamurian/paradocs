/**
 * Relevance configuration section.
 *
 * Holds the thresholds used by the lexical relevance gate. Kept in its own
 * module because `common/config.ts` is close to the 300-line cap.
 *
 * @module common/config-relevance
 */

/** Thresholds and weights for lexical relevance gating. */
export interface RelevanceConfig {
  kbThreshold: number;
  outputThreshold: number;
  prefetchThreshold: number;
  relativeCut: number;
  bodyWeight: number;
}

/** Built-in relevance defaults. */
export const DEFAULT_RELEVANCE_CONFIG: RelevanceConfig = {
  kbThreshold: 0.75,
  outputThreshold: 0.75,
  prefetchThreshold: 0.5,
  relativeCut: 0.9,
  bodyWeight: 0.5,
};

/** Plain-object check that excludes arrays and null. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Clone the relevance defaults so callers cannot mutate the shared constant.
 *
 * @returns A fresh relevance config object.
 */
export function cloneRelevanceDefaults(): RelevanceConfig {
  return { ...DEFAULT_RELEVANCE_CONFIG };
}

/**
 * Read a numeric field constrained to (0, 1], recording an issue on failure.
 *
 * @param section Raw relevance section.
 * @param field Field name to read.
 * @param defaultValue Default used when the field is absent or invalid.
 * @param issues Issue accumulator.
 * @returns The accepted value or the default.
 */
function readUnitNumber(
  section: Record<string, unknown>,
  field: keyof RelevanceConfig,
  defaultValue: number,
  issues: string[],
): number {
  const value = section[field];
  if (value === undefined) return defaultValue;
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0 || value > 1) {
    issues.push(`relevance.${field} must be a number in (0, 1]; using default ${defaultValue}`);
    return defaultValue;
  }
  return value;
}

/**
 * Validate and merge the `relevance` section over the defaults.
 *
 * @param raw Raw `relevance` value from `paradocs.json`.
 * @param issues Issue accumulator.
 * @returns The merged relevance config.
 */
export function mergeRelevance(raw: unknown, issues: string[]): RelevanceConfig {
  const defaults = cloneRelevanceDefaults();
  if (raw === undefined) return defaults;
  if (!isPlainObject(raw)) {
    issues.push("relevance must be an object; using defaults");
    return defaults;
  }

  return {
    kbThreshold: readUnitNumber(raw, "kbThreshold", defaults.kbThreshold, issues),
    outputThreshold: readUnitNumber(raw, "outputThreshold", defaults.outputThreshold, issues),
    prefetchThreshold: readUnitNumber(raw, "prefetchThreshold", defaults.prefetchThreshold, issues),
    relativeCut: readUnitNumber(raw, "relativeCut", defaults.relativeCut, issues),
    bodyWeight: readUnitNumber(raw, "bodyWeight", defaults.bodyWeight, issues),
  };
}
