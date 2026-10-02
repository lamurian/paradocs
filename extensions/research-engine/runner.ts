/**
 * Research engine runner — spawns isolated pi subagents per research question.
 *
 * Each question runs in its own `pi --mode json -p --no-session` subprocess
 * with the researcher.md agent definition appended as system prompt. The
 * subprocess env carries PI_RESEARCH_ENGINE=1 so the KB-first tool_call hook
 * is active inside subagents only. Results are merged and deduplicated by URL.
 *
 * @module extensions/research-engine/runner
 */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { extractJson } from "../../common/extractJson.js";

import type { ResearchResult, ResearchSource, SufficiencyResult } from "./types.js";

/** Maximum number of research subagents running concurrently. */
export const MAX_CONCURRENCY = 4;

/** Minimum suitable sources the research engine aims to collect. */
export const MIN_SOURCES = 10;

/** Path to the researcher agent definition used as subprocess system prompt. */
export const RESEARCHER_PROMPT_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "prompts",
  "researcher.md",
);

/** Minimal context surface the runner needs from commands or tools. */
export interface RunnerContext {
  /** Working directory for subprocess execution. */
  cwd: string;
}

/**
 * Resolve how to invoke the pi CLI in the current runtime.
 *
 * Mirrors the SDK subagent example: reuse the running script when it is a
 * real file, otherwise fall back to the `pi` binary for generic node/bun.
 *
 * @param extraArgs - CLI arguments to append.
 * @returns Command and full argument list for spawn.
 */
export function getPiInvocation(extraArgs: string[]): { command: string; args: string[] } {
  const currentScript = process.argv[1];
  const isBunVirtualScript = currentScript?.startsWith("/$bunfs/root/");
  if (currentScript && !isBunVirtualScript && existsSync(currentScript)) {
    return { command: process.execPath, args: [currentScript, ...extraArgs] };
  }
  const execName = process.execPath.split("/").pop()?.toLowerCase() ?? "";
  const isGenericRuntime = /^(node|bun)(\.exe)?$/.test(execName);
  if (!isGenericRuntime) {
    return { command: process.execPath, args: extraArgs };
  }
  return { command: "pi", args: extraArgs };
}

/**
 * Parse and validate {url, snippet} sources from subagent output text.
 *
 * @param text - Raw text from the final assistant message.
 * @returns Valid research sources; invalid entries are dropped.
 */
export function parseSources(text: string): ResearchSource[] {
  const parsed = extractJson(text);
  if (!Array.isArray(parsed)) return [];
  const sources: ResearchSource[] = [];
  for (const entry of parsed) {
    if (
      entry !== null &&
      typeof entry === "object" &&
      typeof (entry as ResearchSource).url === "string" &&
      typeof (entry as ResearchSource).snippet === "string" &&
      (entry as ResearchSource).url.length > 0
    ) {
      const src = entry as ResearchSource;
      sources.push({ url: src.url, snippet: src.snippet, title: src.title, tier: src.tier });
    }
  }
  return sources;
}

/**
 * Extract the final assistant text from collected JSON mode messages.
 *
 * @param messages - Parsed JSONL events from the subprocess stdout.
 * @returns Joined text of the last assistant message, or empty string.
 */
function getFinalAssistantText(messages: Array<Record<string, unknown>>): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.type !== "message_end") continue;
    const message = msg.message as
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

/**
 * Run one research question in an isolated pi subprocess.
 *
 * @param question - The research question for this subagent.
 * @param cwd - Working directory for the subprocess.
 * @returns Sources collected by the subagent; empty on failure.
 */
async function runSingleQuestion(question: string, cwd: string): Promise<ResearchSource[]> {
  const extraArgs = [
    "--mode",
    "json",
    "-p",
    "--no-session",
    "--append-system-prompt",
    RESEARCHER_PROMPT_PATH,
    `Task: ${question}`,
  ];
  const invocation = getPiInvocation(extraArgs);

  return new Promise<ResearchSource[]>((resolvePromise) => {
    let proc: ReturnType<typeof spawn>;
    try {
      proc = spawn(invocation.command, invocation.args, {
        cwd,
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, PI_RESEARCH_ENGINE: "1" },
      });
    } catch {
      resolvePromise([]);
      return;
    }

    const messages: Array<Record<string, unknown>> = [];
    let buffer = "";

    const processLine = (line: string): void => {
      if (!line.trim()) return;
      try {
        messages.push(JSON.parse(line) as Record<string, unknown>);
      } catch {
        /* ignore non-JSON lines */
      }
    };

    proc.stdout?.on("data", (data: Buffer) => {
      buffer += data.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) processLine(line);
    });

    proc.on("error", () => resolvePromise([]));
    proc.on("close", () => {
      if (buffer.trim()) processLine(buffer);
      resolvePromise(parseSources(getFinalAssistantText(messages)));
    });
  });
}

/**
 * Run tasks with a concurrency limit, preserving input order.
 *
 * @param items - Items to process.
 * @param limit - Maximum concurrent tasks.
 * @param fn - Task function.
 * @returns Results in input order.
 */
async function mapWithConcurrencyLimit<TIn, TOut>(
  items: TIn[],
  limit: number,
  fn: (item: TIn) => Promise<TOut>,
): Promise<TOut[]> {
  if (items.length === 0) return [];
  const bound = Math.max(1, Math.min(limit, items.length));
  const results: TOut[] = new Array<TOut>(items.length);
  let nextIndex = 0;
  const workers = Array.from({ length: bound }, async () => {
    while (true) {
      const current = nextIndex++;
      if (current >= items.length) return;
      results[current] = await fn(items[current]);
    }
  });
  await Promise.all(workers);
  return results;
}

/**
 * Run the research engine across one or more questions.
 *
 * Spawns up to MAX_CONCURRENCY parallel pi subagents, collects {url, snippet}
 * sources from each, deduplicates by URL across questions, and merges into a
 * single ResearchResult with a default sufficiency assessment.
 *
 * @param questions - Research questions to execute in parallel.
 * @param ctx - Context providing the working directory.
 * @returns Merged, deduplicated research result.
 */
export async function runResearchEngine(
  questions: string[],
  ctx: RunnerContext,
): Promise<ResearchResult> {
  const cleanQuestions = questions.map((q) => q.trim()).filter((q) => q.length > 0);
  const perQuestion = await mapWithConcurrencyLimit(cleanQuestions, MAX_CONCURRENCY, (q) =>
    runSingleQuestion(q, ctx.cwd),
  );

  const unique = new Map<string, ResearchSource>();
  for (const sources of perQuestion) {
    for (const src of sources) {
      if (!unique.has(src.url)) unique.set(src.url, src);
    }
  }
  const sources = [...unique.values()];
  const assessment: SufficiencyResult = {
    sufficient: sources.length >= MIN_SOURCES,
    outdatedNotes: [],
    gaps: sources.length < MIN_SOURCES ? cleanQuestions : [],
  };
  return { sources, questions: cleanQuestions, assessment };
}
