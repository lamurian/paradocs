/**
 * Paradocs configuration loader.
 *
 * Reads `<knowledgeDir>/paradocs.json` synchronously and merges it over the
 * built-in defaults. Invalid JSON or wrongly typed values fall back to the
 * default for that value and are reported as human-readable issues.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import {
  cloneRelevanceDefaults,
  DEFAULT_RELEVANCE_CONFIG,
  mergeRelevance,
} from "./config-relevance.ts";

import type { RelevanceConfig } from "./config-relevance.ts";

/** Freshness defaults and per-tag windows (days) or null for never stale. */
export interface FreshnessConfig {
  defaultWindowDays: number;
  tagWindows: Record<string, number | null>;
}

/** Recall settings for the deterministic BM25 prompt lookup. */
export interface RecallConfig {
  maxChars: number;
  maxTerms: number;
  timeoutMs: number;
  maxHits: number;
  skipPatterns: string[];
}

/** Note rendering limits. */
export interface NoteConfig {
  maxContentLines: number;
  wrapWidth: number;
  maxLinks: number;
}

/** Full Paradocs configuration. */
export interface ParadocsConfig {
  freshness: FreshnessConfig;
  recall: RecallConfig;
  note: NoteConfig;
  relevance: RelevanceConfig;
}

/** Built-in defaults used when no config file (or value) is available. */
export const DEFAULT_PARADOCS_CONFIG: ParadocsConfig = {
  freshness: { defaultWindowDays: 365, tagWindows: {} },
  recall: {
    maxChars: 2000,
    maxTerms: 12,
    timeoutMs: 150,
    maxHits: 3,
    skipPatterns: [],
  },
  note: { maxContentLines: 60, wrapWidth: 80, maxLinks: 5 },
  relevance: DEFAULT_RELEVANCE_CONFIG,
};

/** Result of loading configuration, including any validation issues. */
export interface LoadedParadocsConfig {
  config: ParadocsConfig;
  issues: string[];
}

/** True for a positive integer. */
function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

/** Plain-object check that excludes arrays and null. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Clone the defaults so callers cannot mutate the shared constant. */
function cloneDefaults(): ParadocsConfig {
  return {
    freshness: {
      defaultWindowDays: DEFAULT_PARADOCS_CONFIG.freshness.defaultWindowDays,
      tagWindows: { ...DEFAULT_PARADOCS_CONFIG.freshness.tagWindows },
    },
    recall: {
      ...DEFAULT_PARADOCS_CONFIG.recall,
      skipPatterns: [...DEFAULT_PARADOCS_CONFIG.recall.skipPatterns],
    },
    note: { ...DEFAULT_PARADOCS_CONFIG.note },
    relevance: cloneRelevanceDefaults(),
  };
}

/** Read and validate a positive integer field, recording an issue on failure. */
function readPositiveInteger(
  section: Record<string, unknown> | undefined,
  field: string,
  defaultValue: number,
  path: string,
  issues: string[],
): number {
  const value = section?.[field];
  if (value === undefined) return defaultValue;
  if (!isPositiveInteger(value)) {
    issues.push(`${path} must be a positive integer; using default ${defaultValue}`);
    return defaultValue;
  }
  return value;
}

/** Validate and merge the `freshness` section. */
function mergeFreshness(raw: unknown, issues: string[]): FreshnessConfig {
  const defaults = cloneDefaults().freshness;
  if (raw === undefined) return defaults;
  if (!isPlainObject(raw)) {
    issues.push("freshness must be an object; using defaults");
    return defaults;
  }

  const config: FreshnessConfig = {
    defaultWindowDays: readPositiveInteger(
      raw,
      "defaultWindowDays",
      defaults.defaultWindowDays,
      "freshness.defaultWindowDays",
      issues,
    ),
    tagWindows: { ...defaults.tagWindows },
  };

  const tagWindows = raw.tagWindows;
  if (tagWindows !== undefined) {
    if (!isPlainObject(tagWindows)) {
      issues.push("freshness.tagWindows must be an object; using defaults");
    } else {
      for (const [tag, window] of Object.entries(tagWindows)) {
        if (window === null || isPositiveInteger(window)) {
          config.tagWindows[tag] = window;
        } else {
          issues.push(
            `freshness.tagWindows["${tag}"] must be a positive integer or null; ignoring value`,
          );
        }
      }
    }
  }

  return config;
}

/** Validate and merge the `recall` section. */
function mergeRecall(raw: unknown, issues: string[]): RecallConfig {
  const defaults = cloneDefaults().recall;
  if (raw === undefined) return defaults;
  if (!isPlainObject(raw)) {
    issues.push("recall must be an object; using defaults");
    return defaults;
  }

  const config: RecallConfig = {
    maxChars: readPositiveInteger(raw, "maxChars", defaults.maxChars, "recall.maxChars", issues),
    maxTerms: readPositiveInteger(raw, "maxTerms", defaults.maxTerms, "recall.maxTerms", issues),
    timeoutMs: readPositiveInteger(
      raw,
      "timeoutMs",
      defaults.timeoutMs,
      "recall.timeoutMs",
      issues,
    ),
    maxHits: readPositiveInteger(raw, "maxHits", defaults.maxHits, "recall.maxHits", issues),
    skipPatterns: [...defaults.skipPatterns],
  };

  const skipPatterns = raw.skipPatterns;
  if (skipPatterns !== undefined) {
    if (!Array.isArray(skipPatterns) || !skipPatterns.every((p) => typeof p === "string")) {
      issues.push("recall.skipPatterns must be an array of strings; using defaults");
    } else {
      config.skipPatterns = skipPatterns;
    }
  }

  return config;
}

/** Validate and merge the `note` section. */
function mergeNote(raw: unknown, issues: string[]): NoteConfig {
  const defaults = cloneDefaults().note;
  if (raw === undefined) return defaults;
  if (!isPlainObject(raw)) {
    issues.push("note must be an object; using defaults");
    return defaults;
  }

  return {
    maxContentLines: readPositiveInteger(
      raw,
      "maxContentLines",
      defaults.maxContentLines,
      "note.maxContentLines",
      issues,
    ),
    wrapWidth: readPositiveInteger(raw, "wrapWidth", defaults.wrapWidth, "note.wrapWidth", issues),
    maxLinks: readPositiveInteger(raw, "maxLinks", defaults.maxLinks, "note.maxLinks", issues),
  };
}

/**
 * Load Paradocs configuration from `<knowledgeDir>/paradocs.json`.
 *
 * A missing file returns the built-in defaults with no issues. A partial file
 * is deep-merged per section. Invalid JSON or wrongly typed values fall back
 * to the relevant default and append a human-readable issue string.
 *
 * @param knowledgeDir - Directory containing `paradocs.json`.
 * @returns The merged config and any validation issues encountered.
 */
export function loadParadocsConfig(knowledgeDir: string): LoadedParadocsConfig {
  const filePath = join(knowledgeDir, "paradocs.json");
  const issues: string[] = [];

  if (!existsSync(filePath)) {
    return { config: cloneDefaults(), issues };
  }

  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(filePath, "utf8")) as unknown;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    issues.push(`paradocs.json contains invalid JSON (${message}); using defaults`);
    return { config: cloneDefaults(), issues };
  }

  if (!isPlainObject(raw)) {
    issues.push("paradocs.json must contain a JSON object; using defaults");
    return { config: cloneDefaults(), issues };
  }

  return {
    config: {
      freshness: mergeFreshness(raw.freshness, issues),
      recall: mergeRecall(raw.recall, issues),
      note: mergeNote(raw.note, issues),
      relevance: mergeRelevance(raw.relevance, issues),
    },
    issues,
  };
}
