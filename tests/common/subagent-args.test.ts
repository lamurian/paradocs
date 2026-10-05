/**
 * Tests for common/subagent-args.ts — getPiInvocation branches.
 *
 * PI_BIN override and timeout resolution are covered in subagent.test.ts;
 * these tests cover the script-detection and runtime-detection branches.
 *
 * @module tests/common/subagent-args.test
 */

import { describe, it, expect, afterEach } from "vitest";

import { getPiInvocation } from "../../common/subagent-args.js";

const ORIGINAL_ARGV1 = process.argv[1];
const ORIGINAL_EXEC = Object.getOwnPropertyDescriptor(process, "execPath");

function setArgv1(value: string | undefined): void {
  if (value === undefined) process.argv.splice(1, 1);
  else process.argv[1] = value;
}

function setExecPath(value: string): void {
  Object.defineProperty(process, "execPath", { value, configurable: true });
}

describe("getPiInvocation branches", () => {
  afterEach(() => {
    setArgv1(ORIGINAL_ARGV1);
    if (ORIGINAL_EXEC) Object.defineProperty(process, "execPath", ORIGINAL_EXEC);
    delete process.env.PI_BIN;
  });

  it("reuses the running script when argv[1] is a real file", () => {
    // vitest's argv[1] points at a real file on disk.
    const res = getPiInvocation(["--version"]);
    expect(res.command).toBe(process.execPath);
    expect(res.args[0]).toBe(ORIGINAL_ARGV1);
  });

  it("falls back to pi on PATH for generic runtimes without a script", () => {
    setArgv1("/definitely/not/a/real/script.js");
    const res = getPiInvocation(["--version"]);
    expect(res.command).toBe("pi");
    expect(res.args).toEqual(["--version"]);
  });

  it("uses process.execPath directly for non-generic runtimes", () => {
    setArgv1("/definitely/not/a/real/script.js");
    setExecPath("/opt/custom-runtime/bin/custom");
    const res = getPiInvocation(["--version"]);
    expect(res.command).toBe("/opt/custom-runtime/bin/custom");
    expect(res.args).toEqual(["--version"]);
  });

  it("ignores bun virtual scripts under /$bunfs/root/", () => {
    setArgv1("/$bunfs/root/index.js");
    const res = getPiInvocation(["--version"]);
    expect(res.command).toBe("pi");
  });
});
