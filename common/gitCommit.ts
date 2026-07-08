/**
 * Knowledge base git commit helper.
 *
 * Runs git add and commit in the knowledge base directory using
 * Node.js child_process. The commit message is typically generated
 * by the LLM during sufficiency evaluation.
 *
 * @module common/gitCommit
 */

import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { getKnowledgeConfig } from "./env.js";

/**
 * Commit a message to the knowledge base git repository.
 *
 * Checks if the KB directory is a git repo, stages all changes,
 * commits with the given message, and returns the resulting hash.
 * All errors (not a repo, no changes, git not found) are caught
 * gracefully with a console warning.
 *
 * @param message - The commit message (will be truncated to 72 chars).
 * @param cwd     - Working directory for env config resolution.
 * @returns Object with ok status and optional commit hash.
 */
export function commitKnowledgeBase(
  message: string,
  cwd: string,
): Promise<{ ok: boolean; hash?: string }> {
  const { dir } = getKnowledgeConfig(cwd);

  // Check if the KB directory has a .git folder
  if (!existsSync(resolve(dir, ".git"))) {
    console.warn("[gitCommit] Not a git repository, skipping:", dir);
    return Promise.resolve({ ok: false });
  }

  // Truncate message to 72 chars (git convention)
  const safeMsg = message.slice(0, 72);

  try {
    execSync("git add -A", { cwd: dir });
    execSync(`git commit -m "${safeMsg}"`, { cwd: dir });
    const hash = execSync("git rev-parse HEAD", { cwd: dir });
    return Promise.resolve({ ok: true, hash: hash.toString().trim() });
  } catch {
    // e.g. nothing to commit, git not installed, etc.
    return Promise.resolve({ ok: false });
  }
}
