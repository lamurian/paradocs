/**
 * Command/tool-facing dependency builder for the research orchestrator.
 *
 * Wires the orchestrator's injected surface to the subagent transport:
 * every LLM boundary (summarize/judge/synthesis) and the search stage
 * spawn lean `pi` subprocesses instead of in-process pi-ai calls, so
 * auth, model resolution, and response parsing go through pi's own
 * machinery. Fetching, KB search, and checkpoints stay in-process.
 *
 * @module extensions/research-engine/deps
 */

import { buildSearchAgentArgs, parseSearchResult } from "./runner.js";
import { writeBackToKB } from "./writeback.js";
import { configureEnv, getKnowledgeConfig } from "../../common/env.js";
import { fetchUrlWithTimeout } from "../../common/fetchUrl.js";
import { ensureNotesDb } from "../../common/notesDb.js";
import { buildSubagentArgs, resolveSubagentTimeoutMs, runSubagent } from "../../common/subagent.js";
import { searchDocs } from "../para-knowledge/db-sqlite.js";

import type { ResearchDeps, SearchSubagentOutcome } from "./research-deps.js";
import type { ResearchSource, RuntimeModel, SubagentModel, WritebackResult } from "./types.js";
import type { WritebackContext } from "./writeback.js";
import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

/** Resolved model auth for the pipeline (subprocess resolves credentials itself). */
export interface ResearchAuth {
  model: RuntimeModel;
}

/** Minimal context surface the deps builder needs. */
export interface DepsContext {
  cwd: string;
  mode: string;
  modelRegistry: ExtensionCommandContext["modelRegistry"];
  ui: ExtensionCommandContext["ui"];
}

/** Options for buildResearchDeps. */
export interface BuildDepsOptions {
  allowEscalation?: boolean;
  signal?: AbortSignal;
}

/**
 * Build the orchestrator deps for a command or tool context.
 *
 * @param ctx - Command/tool context (cwd, mode, ui).
 * @param auth - Resolved runtime model (subprocess handles credentials).
 * @param opts - Escalation flag, abort signal.
 * @returns ResearchDeps wired to the subagent transport.
 */
export function buildResearchDeps(
  ctx: DepsContext,
  auth: ResearchAuth,
  opts: BuildDepsOptions = {},
): ResearchDeps {
  const subagent: SubagentModel = {
    provider: auth.model.provider,
    modelId: auth.model.id,
  };

  const llm: ResearchDeps["llm"] = async (input) => {
    if (ctx.mode === "tui") ctx.ui.setWorkingMessage(input.label ?? "Researching…");
    const args = buildSubagentArgs({
      provider: subagent.provider,
      modelId: subagent.modelId,
      systemPrompt: input.system,
      task: input.user,
      extraArgs: ["--no-tools"],
    });
    const res = await runSubagent({
      args,
      cwd: ctx.cwd,
      timeoutMs: resolveSubagentTimeoutMs(input.role ?? "synthesis", input.timeoutMs),
      signal: opts.signal,
      parse: input.parse,
    });
    if (res.ok) return { ok: true, value: res.value };
    return { ok: false, error: res.error };
  };

  const searchSubagent: ResearchDeps["searchSubagent"] = async (
    input,
  ): Promise<SearchSubagentOutcome> => {
    if (ctx.mode === "tui") ctx.ui.setWorkingMessage("Searching…");
    const args = buildSearchAgentArgs({
      provider: subagent.provider,
      modelId: subagent.modelId,
      task: input.task,
    });
    const res = await runSubagent<SearchSubagentOutcome["value"]>({
      args,
      cwd: ctx.cwd,
      timeoutMs: resolveSubagentTimeoutMs("search", input.timeoutMs),
      signal: input.signal ?? opts.signal,
      parse: parseSearchResult,
    });
    if (res.ok) return { ok: true, value: res.value ?? undefined };
    return { ok: false, error: res.error };
  };

  return {
    llm,
    searchSubagent,
    searchDocs: async (query) => {
      configureEnv(ctx.cwd);
      const db = await ensureNotesDb(ctx.cwd);
      return searchDocs(db, query, {}, 10).map((d) => ({
        title: d.title,
        path: d.path,
        created: d.created ?? undefined,
      }));
    },
    fetchUrl: async (url, timeoutMs, signal) => {
      const res = await fetchUrlWithTimeout(url, timeoutMs, signal);
      return "error" in res ? { error: res.error } : { title: res.title, content: res.content };
    },
    writeBack: async (input): Promise<WritebackResult> => {
      const wbCtx: WritebackContext = {
        cwd: ctx.cwd,
        model: auth.model,
        signal: opts.signal,
      };
      return writeBackToKB(
        {
          sources: input.sources,
          questions: input.questions,
          assessment: { sufficient: false, outdatedNotes: [], gaps: [] },
          jobId: input.jobId,
          synthesis: input.synthesis,
        },
        wbCtx,
      );
    },
    knowledgeDir: getKnowledgeConfig(ctx.cwd).dir,
    notify: (message) => ctx.ui.notify(message, "info"),
    signal: opts.signal,
    allowEscalation: opts.allowEscalation,
    fetchTimeoutMs: 20_000,
  };
}

/** Re-exported for tests that build write-back inputs. */
export type { ResearchSource };
