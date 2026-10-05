/**
 * Fake child-process spawn harness for common/subagent tests.
 *
 * Builds scripted fake pi processes that emit stdout/stderr JSONL events
 * and close (or hang, or fail) — no real subprocess ever spawns.
 *
 * @module tests/common/helpers/fake-subagent
 */

interface FakeProc {
  stdout: { on(event: string, cb: (d: Buffer) => void): void };
  stderr: { on(event: string, cb: (d: Buffer) => void): void };
  on(event: string, cb: (...a: never[]) => void): void;
  killCalls: string[];
  kill(signal: string): void;
}

/** Factory producing fake child processes; records every spawned proc. */
export type FakeSpawnFactory = ((command: string, args: string[], options: unknown) => FakeProc) & {
  procs: FakeProc[];
};

/** Build a fake child process factory that emits scripted stdout/stderr then closes. */
export function fakeSpawn(cfg: {
  stdout?: string;
  stderr?: string;
  exitCode?: number;
  hang?: boolean;
  spawnError?: Error;
}): FakeSpawnFactory {
  const procs: FakeProc[] = [];
  const factory = (() => {
    const stdoutHandlers: Array<(d: Buffer) => void> = [];
    const stderrHandlers: Array<(d: Buffer) => void> = [];
    const closeHandlers: Array<(...a: unknown[]) => void> = [];
    const errorHandlers: Array<(e: Error) => void> = [];
    let closed = false;
    const emitClose = (code: number | null, signal: string | null): void => {
      if (closed) return;
      closed = true;
      for (const cb of closeHandlers) cb(code, signal);
    };
    const proc: FakeProc = {
      stdout: { on: (_e, cb) => stdoutHandlers.push(cb) },
      stderr: { on: (_e, cb) => stderrHandlers.push(cb) },
      on: (e, cb) => {
        if (e === "close") closeHandlers.push(cb as (...a: unknown[]) => void);
        if (e === "error") errorHandlers.push(cb as (err: Error) => void);
      },
      killCalls: [],
      kill(signal: string) {
        this.killCalls.push(signal);
        // Killed processes close with a signal.
        setTimeout(() => emitClose(null, "SIGKILL"), 5);
      },
    };
    setTimeout(() => {
      if (cfg.spawnError) {
        for (const cb of errorHandlers) cb(cfg.spawnError);
        return;
      }
      if (cfg.stdout) for (const cb of stdoutHandlers) cb(Buffer.from(cfg.stdout));
      if (cfg.stderr) for (const cb of stderrHandlers) cb(Buffer.from(cfg.stderr));
      if (!cfg.hang) emitClose(cfg.exitCode ?? 0, null);
    }, 5);
    procs.push(proc);
    return proc;
  }) as unknown as FakeSpawnFactory;
  Object.defineProperty(factory, "procs", { value: procs });
  return factory;
}

/** Two JSONL message_end events plus a trailing newline. */
export const TWO_EVENTS = [
  '{"type":"message_end","message":{"role":"assistant","content":[{"type":"text","text":"first answer"}]}}',
  '{"type":"message_end","message":{"role":"assistant","content":[{"type":"text","text":"second answer"}]}}',
  "",
].join("\n");
