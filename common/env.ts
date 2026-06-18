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

import { config } from "dotenv";
import { resolve } from "node:path";
import { existsSync } from "node:fs";
import { homedir } from "node:os";

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
  const globalEnv =
    options?.globalEnvPath ?? resolve(homedir(), ".pi", "agent", ".env");
  if (existsSync(globalEnv)) {
    config({ path: globalEnv });
  }

  // Layer 3: project config (with override — beats everything)
  if (cwd) {
    const projectEnv =
      options?.projectEnvPath ?? resolve(cwd, ".pi", ".env");
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
