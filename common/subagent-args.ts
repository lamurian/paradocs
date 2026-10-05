/**
 * Subagent CLI argument builders and timeout resolution.
 *
 * Shared by the search-stage runner, the deps.llm transport, and the
 * write-back grouping call. --append-system-prompt takes literal TEXT
 * (read in the parent process), never a file path.
 *
 * @module common/subagent-args
 */

import { existsSync } from "node:fs";
import { basename } from "node:path";

/** Minimal process surface the runner needs (fakeable in tests). */
export interface SubagentProcess {
  stdout: { on(event: "data", cb: (chunk: Buffer) => void): void };
  stderr: { on(event: "data", cb: (chunk: Buffer) => void): void };
  on(event: "close", cb: (code: number | null, signal: string | null) => void): void;
  on(event: "error", cb: (err: Error) => void): void;
  kill(signal: string): void;
}

/** Factory producing a child process (injectable for tests). */
export type SpawnImpl = (
  command: string,
  args: string[],
  options: Record<string, unknown>,
) => SubagentProcess;

/** Per-role default timeouts (ms); env-overridable. */
const ROLE_TIMEOUTS: Record<string, number> = {
  search: 120_000,
  synthesis: 120_000,
  grouping: 120_000,
  summarize: 60_000,
  judge: 60_000,
};

/**
 * Build argv for a lean tool-less pi subagent.
 *
 * Flag order: base lean flags, then role extras (e.g. -e/--tools for the
 * search role), then --provider/--model, then the literal system prompt
 * (--append-system-prompt takes literal TEXT, never a file path), and
 * finally the task as the positional prompt.
 *
 * @param input - Provider/model ids, literal system prompt text, task, role extras.
 * @returns Full argv array.
 */
export function buildSubagentArgs(input: {
  provider: string;
  modelId: string;
  systemPrompt: string;
  task: string;
  extraArgs?: string[];
}): string[] {
  return [
    "--mode",
    "json",
    "-p",
    "--no-session",
    "--no-extensions",
    ...(input.extraArgs ?? []),
    "--offline",
    "--thinking",
    "minimal",
    "--no-context-files",
    "--no-skills",
    "--provider",
    input.provider,
    "--model",
    input.modelId,
    "--append-system-prompt",
    input.systemPrompt,
    `Task: ${input.task}`,
  ];
}

/**
 * Resolve how to invoke the pi CLI.
 *
 * PI_BIN env override wins; otherwise reuse the running script when it is
 * a real file, falling back to `pi` on PATH for generic node/bun runtimes.
 *
 * @param args - CLI arguments to append.
 * @returns Command and full argument list for spawn.
 */
export function getPiInvocation(args: string[]): { command: string; args: string[] } {
  const piBin = process.env.PI_BIN;
  if (piBin) return { command: piBin, args };
  const currentScript = process.argv[1];
  const isBunVirtualScript = currentScript?.startsWith("/$bunfs/root/");
  if (currentScript && !isBunVirtualScript && existsSync(currentScript)) {
    return { command: process.execPath, args: [currentScript, ...args] };
  }
  const execName = basename(process.execPath).toLowerCase();
  const isGenericRuntime = /^(node|bun)(\.exe)?$/.test(execName);
  if (!isGenericRuntime) return { command: process.execPath, args };
  return { command: "pi", args };
}

/**
 * Resolve the timeout for a subagent role.
 *
 * Precedence: explicit override → PI_SUBAGENT_TIMEOUT_MS_<ROLE> →
 * PI_SUBAGENT_TIMEOUT_MS → role default (search/synthesis/grouping 120s,
 * summarize/judge 60s).
 *
 * @param role - Pipeline role (search, summarize, judge, synthesis, grouping).
 * @param overrideMs - Explicit timeout from the caller.
 * @returns Timeout in milliseconds.
 */
export function resolveSubagentTimeoutMs(role: string, overrideMs?: number): number {
  if (overrideMs !== undefined && overrideMs > 0) return overrideMs;
  const roleEnv = process.env[`PI_SUBAGENT_TIMEOUT_MS_${role.toUpperCase()}`];
  const parsedRole = Number(roleEnv);
  if (roleEnv && Number.isFinite(parsedRole) && parsedRole > 0) return parsedRole;
  const globalEnv = process.env.PI_SUBAGENT_TIMEOUT_MS;
  const parsedGlobal = Number(globalEnv);
  if (globalEnv && Number.isFinite(parsedGlobal) && parsedGlobal > 0) return parsedGlobal;
  return ROLE_TIMEOUTS[role] ?? 120_000;
}
