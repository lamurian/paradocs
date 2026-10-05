/**
 * Subagent transport: spawn an isolated `pi` subprocess for one LLM call.
 *
 * Replaces the in-process pi-ai `complete()` path (which masked every
 * provider failure as "LLM returned invalid JSON"). Subprocesses run the
 * installed pi runtime with lean flags, so auth, model resolution, and
 * response parsing go through pi's own machinery. Failures surface the
 * real cause: exit code, stderr snippet, JSON error events, or a
 * raw-text excerpt on parse failure.
 *
 * @module common/subagent
 */

import { spawn } from "node:child_process";

import { getPiInvocation } from "./subagent-args.js";

import type { SpawnImpl, SubagentProcess } from "./subagent-args.js";

// Re-exported for import stability (deps, runner, writeback, tests).
export { buildSubagentArgs, getPiInvocation, resolveSubagentTimeoutMs } from "./subagent-args.js";
export type { SpawnImpl, SubagentProcess } from "./subagent-args.js";

/** Result of one subagent run. Errors always carry the real cause. */
export type SubagentResult<T> = { ok: true; text: string; value: T } | { ok: false; error: string };

/** Options for one subagent run. */
export interface RunSubagentOptions {
  /** Full argv for the pi subprocess (from buildSubagentArgs / buildSearchAgentArgs). */
  args: string[];
  /** Working directory for the subprocess. */
  cwd?: string;
  /** Extra environment variables (merged over process.env). */
  env?: Record<string, string | undefined>;
  /** Wall-clock timeout; kills with SIGKILL when exceeded. */
  timeoutMs?: number;
  /** Parent abort signal (e.g. pipeline cancellation). */
  signal?: AbortSignal;
  /** Parser applied to the final assistant text; null → raw-text error. */
  parse?: (text: string) => unknown;
  /** Process factory override (tests). */
  spawnImpl?: SpawnImpl;
}

// ── JSONL extraction ──────────────────────────────────────────────────

/**
 * Extract the final assistant text from parsed JSON mode events.
 *
 * Walks message_end events backwards and joins the text parts of the
 * last assistant message.
 *
 * @param events - Parsed JSONL events from subprocess stdout.
 * @returns Joined assistant text, or empty string.
 */
export function extractFinalAssistantText(events: Array<Record<string, unknown>>): string {
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i];
    if (event.type !== "message_end") continue;
    const message = event.message as
      | { role?: string; content?: Array<{ type: string; text?: string }> }
      | undefined;
    if (message?.role !== "assistant" || !Array.isArray(message.content)) continue;
    const text = message.content
      .filter((c) => c.type === "text" && typeof c.text === "string")
      .map((c) => c.text)
      .join("\n");
    if (text.trim()) return text;
  }
  return "";
}

// ── Runner ────────────────────────────────────────────────────────────

function truncate(text: string, max = 200): string {
  return text.length > max ? text.slice(0, max) : text;
}

/**
 * Run one pi subagent call and return its final assistant text.
 *
 * Spawns the process, parses JSONL stdout, enforces a wall-clock timeout
 * (SIGKILL) combined with the parent abort signal, and captures stderr.
 * Never throws: every failure mode returns { ok: false, error } carrying
 * the real cause.
 *
 * @param options - Args, cwd, env, timeout, signal, parse, spawn override.
 * @returns Parsed result with the raw text, or a structured error.
 */
export async function runSubagent<T = string>(
  options: RunSubagentOptions,
): Promise<SubagentResult<T>> {
  const { args, cwd, env, signal, parse, spawnImpl } = options;
  const timeoutMs = options.timeoutMs ?? 120_000;
  const invocation = getPiInvocation(args);
  const doSpawn: SpawnImpl =
    spawnImpl ?? ((command, a, opts) => spawn(command, a, opts) as unknown as SubagentProcess);

  return new Promise<SubagentResult<T>>((resolvePromise) => {
    let proc: SubagentProcess;
    try {
      proc = doSpawn(invocation.command, invocation.args, {
        cwd,
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, ...env },
      });
    } catch (e: unknown) {
      resolvePromise({ ok: false, error: e instanceof Error ? e.message : String(e) });
      return;
    }

    const events: Array<Record<string, unknown>> = [];
    let stdoutBuffer = "";
    let stderr = "";
    let settled = false;
    let timedOut = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const finish = (result: SubagentResult<T>): void => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      resolvePromise(result);
    };

    function onAbort(): void {
      proc.kill("SIGKILL");
      finish({ ok: false, error: "subagent aborted" });
    }

    const processLine = (line: string): void => {
      if (!line.trim()) return;
      try {
        events.push(JSON.parse(line) as Record<string, unknown>);
      } catch {
        /* non-JSON lines are ignored */
      }
    };

    proc.stdout.on("data", (chunk: Buffer) => {
      stdoutBuffer += chunk.toString();
      const lines = stdoutBuffer.split("\n");
      stdoutBuffer = lines.pop() ?? "";
      for (const line of lines) processLine(line);
    });
    proc.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    proc.on("error", (err: Error) => {
      finish({ ok: false, error: err.message });
    });
    proc.on("close", (code: number | null, _procSignal: string | null) => {
      if (stdoutBuffer.trim()) processLine(stdoutBuffer);
      if (timedOut) {
        finish({
          ok: false,
          error: `subagent timed out after ${timeoutMs}ms${stderr.trim() ? `: ${stderr.trim().slice(0, 200)}` : ""}`,
        });
        return;
      }
      const text = extractFinalAssistantText(events);
      if (!text.trim()) {
        const detail = stderr.trim() || (code !== 0 ? `exited with code ${code}` : "");
        finish({
          ok: false,
          error: detail ? `no assistant output (${detail})` : "no assistant output",
        });
        return;
      }
      if (parse) {
        const value = parse(text);
        if (value === null || value === undefined) {
          finish({
            ok: false,
            error: `unparseable subagent response: ${truncate(text)}`,
          });
          return;
        }
        finish({ ok: true, text, value: value as T });
        return;
      }
      finish({ ok: true, text, value: text as unknown as T });
    });

    if (signal) {
      if (signal.aborted) {
        onAbort();
        return;
      }
      signal.addEventListener("abort", onAbort, { once: true });
    }
    if (timeoutMs > 0) {
      timer = setTimeout(() => {
        timedOut = true;
        proc.kill("SIGKILL");
      }, timeoutMs);
    }
  });
}
