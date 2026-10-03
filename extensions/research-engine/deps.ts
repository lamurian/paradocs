/**
 * Command/tool-facing dependency builder for the research orchestrator.
 *
 * Wires the orchestrator's injected surface to the shared modules:
 * direct LLM calls (TUI loader in interactive mode), in-process KB
 * search, tiered web search, timed URL fetching, and KB write-back.
 *
 * @module extensions/research-engine/deps
 */

import { writeBackToKB } from "./writeback.js";
import { configureEnv, getKnowledgeConfig } from "../../common/env.js";
import { fetchUrlWithTimeout } from "../../common/fetchUrl.js";
import { callLlmDirect, callLlmWithLoader } from "../../common/llm.js";
import { ensureNotesDb } from "../../common/notesDb.js";
import { searchWeb } from "../../common/webSearch.js";
import { searchDocs } from "../para-knowledge/db-sqlite.js";

import type { LlmCallOutcome, ResearchDeps } from "./research-deps.js";
import type { SearchDeps } from "./search.js";
import type { ResearchSource } from "./types.js";
import type { WritebackContext } from "./writeback.js";
import type { LlmCallResult } from "../../common/llm.js";
import type { Api, Model } from "@earendil-works/pi-ai";
import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

/** Resolved model auth for the pipeline. */
export interface ResearchAuth {
  model: Model<Api>;
  apiKey: string;
  headers?: Record<string, string>;
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
  searchDeps?: SearchDeps;
}

function normalizeLlm(res: LlmCallResult<unknown>): LlmCallOutcome {
  if (res.ok) return { ok: true, value: res.value };
  return { ok: false, error: res.type === "error" ? res.message : "cancelled" };
}

/**
 * Build the orchestrator deps for a command or tool context.
 *
 * @param ctx - Command/tool context (cwd, mode, ui, modelRegistry).
 * @param auth - Resolved model + API key.
 * @param opts - Escalation flag, abort signal, search backend override.
 * @returns ResearchDeps wired to the shared modules.
 */
export function buildResearchDeps(
  ctx: DepsContext,
  auth: ResearchAuth,
  opts: BuildDepsOptions = {},
): ResearchDeps {
  const llm: ResearchDeps["llm"] = async (input) => {
    const messageContent = [{ type: "text" as const, text: input.user }];
    if (ctx.mode === "tui") {
      const res = await ctx.ui.custom<LlmCallResult<unknown> | null>((tui, theme, _kb, done) =>
        callLlmWithLoader(
          tui,
          theme,
          done,
          input.label ?? "Researching…",
          auth.model,
          auth,
          input.system,
          messageContent,
          input.parse,
        ),
      );
      return normalizeLlm(res ?? { ok: false, type: "cancelled" });
    }
    const res = await callLlmDirect<unknown>(
      auth.model,
      auth,
      input.system,
      messageContent,
      input.parse,
      opts.signal,
      input.timeoutMs,
    );
    return normalizeLlm(res);
  };

  return {
    llm,
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
    writeBack: async (input: { sources: ResearchSource[]; questions: string[] }) => {
      const wbCtx: WritebackContext = {
        cwd: ctx.cwd,
        model: auth.model,
        modelRegistry: ctx.modelRegistry,
      };
      return writeBackToKB(
        {
          sources: input.sources,
          questions: input.questions,
          assessment: { sufficient: false, outdatedNotes: [], gaps: [] },
        },
        wbCtx,
      );
    },
    knowledgeDir: getKnowledgeConfig(ctx.cwd).dir,
    notify: (message) => ctx.ui.notify(message, "info"),
    signal: opts.signal,
    allowEscalation: opts.allowEscalation,
    searchDeps: opts.searchDeps ?? { searchWeb: (q, o) => searchWeb(q, o) },
    fetchTimeoutMs: 20_000,
    llmTimeoutMs: 120_000,
  };
}
