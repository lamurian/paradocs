/**
 * Environment variable loader.
 *
 * Provides a three-layer dotenv cascade:
 * 1. Hardcoded defaults (lowest priority)
 * 2. Global config at `~/.pi/agent/.env`
 * 3. Project-local config at `<cwd>/.pi/.env` (highest priority)
 *
 * Also exports `expandTilde` for tilde expansion in path-like env vars.
 */

import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";

import { config } from "dotenv";

// ---------------------------------------------------------------------------
// Default values
// ---------------------------------------------------------------------------

/** Default environment variables applied before any .env files. */
export const DEFAULTS: Record<string, string> = {
  SEARXNG_PORT: "8888",
};

/** Apply defaults to process.env (does not override existing values). */
function applyDefaults(): void {
  for (const [key, value] of Object.entries(DEFAULTS)) {
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

// ---------------------------------------------------------------------------
// Lazy singleton guard
// ---------------------------------------------------------------------------

let configured = false;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Configure environment variables via three-layer cascade.
 *
 * Layer 1: Hardcoded defaults (lowest priority)
 * Layer 2: `~/.pi/agent/.env` global user config
 * Layer 3: `<cwd>/.pi/.env` project-local config (highest priority)
 *
 * The function is a lazy singleton — the first call performs the cascade,
 * subsequent calls are no-ops.
 *
 * @param cwd - Current working directory (project root). If omitted, only
 *              the global layer is loaded alongside defaults.
 * @param options - Internal options for testing. When `globalEnvPath` or
 *                  `projectEnvPath` are provided, they override the default
 *                  paths derived from homedir and cwd.
 */
export function configureEnv(
  cwd?: string,
  options?: { globalEnvPath?: string; projectEnvPath?: string },
): void {
  if (configured) return;
  configured = true;

  // Layer 2: global config (no override — only fills gaps)
  const globalEnv = options?.globalEnvPath ?? resolve(homedir(), ".pi", "agent", ".env");
  if (existsSync(globalEnv)) {
    config({ path: globalEnv });
  }

  // Layer 3: project config (with override — beats everything)
  if (cwd) {
    const projectEnv = options?.projectEnvPath ?? resolve(cwd, ".pi", ".env");
    if (existsSync(projectEnv)) {
      config({ path: projectEnv, override: true });
    }
  }

  // Layer 1: defaults (lowest priority — only if not set by env files)
  applyDefaults();
}

/**
 * Expand a leading `~` in a path-like string to the user's home directory.
 *
 * Only handles `~` alone or `~/path`. Does NOT handle `~user` expansion.
 *
 * @param path - Path string that may start with `~`.
 * @returns Path with `~` expanded, or the original string if no tilde.
 */
export function expandTilde(path: string): string {
  if (path.startsWith("~/")) {
    return resolve(homedir(), path.slice(2));
  }
  if (path === "~") {
    return homedir();
  }
  return path;
}

// ---------------------------------------------------------------------------
// Typed config interfaces
// ---------------------------------------------------------------------------

/** Configuration for the PARA knowledge base. */
export interface KnowledgeConfig {
  /** Path to the PARA documents root directory. */
  dir: string;
  /** SQLite database filename (relative to dir). */
  db: string;
}

/** Configuration for the SearXNG search engine. */
export interface SearxngConfig {
  port: number;
  host: string;
  secretKey: string;
  version: string;
}

/** Configuration for the Obscura headless browser. */
export interface ObscuraConfig {
  port: number;
  host: string;
  version: string;
}

/** API keys for external services. */
export interface ApiKeysConfig {
  tavily: string;
  github: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Parse a port number from a string env var, returning the default if the
 * value is undefined, empty, or outside the valid port range (1-65535).
 *
 * @param val - The string value from process.env (may be undefined).
 * @param defaultVal - Default port to return if val is not a valid port.
 * @returns Parsed port number or default.
 */
export function parsePort(val: string | undefined, defaultVal: number): number {
  if (val === undefined || val === "") return defaultVal;
  const n = Number(val);
  if (Number.isNaN(n) || !Number.isInteger(n) || n < 1 || n > 65535) {
    return defaultVal;
  }
  return n;
}

// ---------------------------------------------------------------------------
// Typed config getters
// ---------------------------------------------------------------------------

const DEFAULT_KNOWLEDGE_DIR = "~/data/personal/Documents/Cognoscere";
const DEFAULT_KNOWLEDGE_DB = "notes.db";
const DEFAULT_SEARXNG_PORT = 8888;
const DEFAULT_SEARXNG_HOST = "127.0.0.1";
const DEFAULT_SEARXNG_SECRET_KEY = "thissisanotherthingtodo!";
const DEFAULT_SEARXNG_VERSION = "latest";
const DEFAULT_OBSCURA_PORT = 9222;
const DEFAULT_OBSCURA_HOST = "127.0.0.1";
const DEFAULT_OBSCURA_VERSION = "latest";

/**
 * Get the PARA knowledge base configuration.
 *
 * Reads KNOWLEDGE_DIR (tilde-expanded) and KNOWLEDGE_DB from the
 * environment, falling back to sensible defaults.
 *
 * @returns The current knowledge base configuration.
 */
export function getKnowledgeConfig(): KnowledgeConfig {
  return {
    dir: expandTilde(process.env.KNOWLEDGE_DIR ?? DEFAULT_KNOWLEDGE_DIR),
    db: process.env.KNOWLEDGE_DB ?? DEFAULT_KNOWLEDGE_DB,
  };
}

/**
 * Get the SearXNG search engine configuration.
 *
 * Reads SEARXNG_PORT, SEARXNG_HOST, SEARXNG_SECRET_KEY, and SEARXNG_VERSION
 * from the environment, falling back to sensible defaults.
 *
 * @returns The current SearXNG configuration.
 */
export function getSearxngConfig(): SearxngConfig {
  return {
    port: parsePort(process.env.SEARXNG_PORT, DEFAULT_SEARXNG_PORT),
    host: process.env.SEARXNG_HOST ?? DEFAULT_SEARXNG_HOST,
    secretKey: process.env.SEARXNG_SECRET_KEY ?? DEFAULT_SEARXNG_SECRET_KEY,
    version: process.env.SEARXNG_VERSION ?? DEFAULT_SEARXNG_VERSION,
  };
}

/**
 * Get the Obscura headless browser configuration.
 *
 * Reads OBSCURA_PORT, OBSCURA_HOST, and OBSCURA_VERSION from the
 * environment, falling back to sensible defaults.
 *
 * @returns The current Obscura configuration.
 */
export function getObscuraConfig(): ObscuraConfig {
  return {
    port: parsePort(process.env.OBSCURA_PORT, DEFAULT_OBSCURA_PORT),
    host: process.env.OBSCURA_HOST ?? DEFAULT_OBSCURA_HOST,
    version: process.env.OBSCURA_VERSION ?? DEFAULT_OBSCURA_VERSION,
  };
}

/**
 * Get API keys for external services.
 *
 * Reads TAVILY_KEY and GITHUB_TOKEN from the environment, falling back
 * to empty strings.
 *
 * @returns The current API keys configuration.
 */
export function getApiKeys(): ApiKeysConfig {
  return {
    tavily: process.env.TAVILY_KEY ?? "",
    github: process.env.GITHUB_TOKEN ?? "",
  };
}
