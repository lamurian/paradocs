/**
 * ask tool — deterministic research pipeline with quick/deep modes.
 *
 * Quick mode (default) runs the FSM orchestrator in-tool with the ask-quick
 * profile; when the deterministic guard reports a scope shortfall on a
 * healthy pipeline, it auto-escalates into a detached deep job seeded with
 * the collected state. Deep mode starts that background job immediately and
 * delivers results via a followUp user message. Every result carries the
 * digest (questions per cycle, source count, gaps) and the state path.
 *
 * @module extensions/commands/tools/ask
 */

import { Type } from "typebox";

import { configureEnv, getKnowledgeConfig } from "../../../common/env.js";
import { checkpointPathFor } from "../../research-engine/checkpoint.js";
import { buildResearchDeps } from "../../research-engine/deps.js";
import { canonicalizeUrl } from "../../research-engine/fetcher.js";
import { runResearch } from "../../research-engine/orchestrator.js";
import { ASK_DEEP_PROFILE, ASK_QUICK_PROFILE } from "../../research-engine/profiles.js";
import { buildDigest } from "../../research-engine/state.js";

import type { ResearchAuth } from "../../research-engine/deps.js";
import type { GateProfile, ResearchState } from "../../research-engine/state.js";
import type { Api, Model } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

/** Answer text for a terminal state (errors surfaced, never swallowed). */
function answerOf(state: ResearchState): string {
  return state.synthesis && state.synthesis.trim().length > 0
    ? state.synthesis
    : `_(synthesis unavailable: ${state.synthesisError ?? "no sources collected"})_`;
}

/**
 * Render the tool result: answer, digest, escalation line, state path.
 *
 * @param state - Terminal research state.
 * @param statePath - Checkpoint file path for the job.
 * @param deepJobId - Detached deep job id when escalation fired.
 * @returns Tool result text.
 */
export function renderToolResult(
  state: ResearchState,
  statePath: string,
  deepJobId?: string,
): string {
  const digest = buildDigest(state);
  const cycles = digest.questionsByCycle
    .map((qs, i) => `cycle${i + 1}: [${qs.join("; ")}]`)
    .join(" | ");
  const lines = [
    `🔬 Research complete: ${state.summaries.length} source(s).`,
    "",
    "### Answer",
    answerOf(state),
    "",
    `Digest: questions by cycle: ${cycles || "(none)"}; sources: ${digest.sourceCount}; gaps: ${digest.gaps.join("; ") || "(none)"}`,
  ];
  if (state.escalation?.escalate && deepJobId) {
    lines.push(`⚡ escalated to deep research: ${state.escalation.reason} (job ${deepJobId})`);
  }
  lines.push(`State: ${statePath}`);
  return lines.join("\n");
}

/**
 * Resolve the model and API key for the research pipeline.
 *
 * @param ctx - The tool extension context.
 * @returns Auth info, or an error message when unavailable.
 */
async function resolveToolAuth(
  ctx: ExtensionContext,
): Promise<{ auth: ResearchAuth } | { error: string }> {
  if (!ctx.model) {
    return { error: "❌ No model selected for the research pipeline." };
  }
  const model = ctx.model as Model<Api>;
  const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
  if (!auth.ok || !auth.apiKey) {
    return { error: `❌ No API key for ${model.provider}.` };
  }
  return { auth: { model, apiKey: auth.apiKey, headers: auth.headers } };
}

/** Register the ask tool. */
export function registerAskTool(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "ask",
    label: "Ask the Knowledge Base",
    description:
      "Deterministic research pipeline for a question: KB-first, then tiered web search, " +
      "per-source summarization, and sufficiency-gated cycles. Writes results back to the " +
      "knowledge base (KNOWLEDGE_DIR from .env, not the cwd). Quick mode runs in-tool " +
      "(1 cycle, 5 sources); deep mode runs a background job and delivers via followUp.",
    promptSnippet:
      "Deterministic research pipeline — KB-first, sufficiency-gated cycles, knowledge base write-back",
    promptGuidelines: [
      "Call ask first when you need supporting information — it researches the knowledge base and web, then improves the knowledge base.",
      "Results are written to KNOWLEDGE_DIR (from .env), not the current working directory.",
      'Pass mode:"deep" for broad questions; results arrive as a follow-up message while you keep working.',
      "Pass avoidQuestions/knownSources from a previous result's digest to avoid duplicate work.",
      "Every result includes the digest, gaps, and the state file path for inspection.",
    ],
    parameters: Type.Object({
      question: Type.String({ description: "The question to research" }),
      mode: Type.Optional(
        Type.Union([Type.Literal("quick"), Type.Literal("deep")], {
          description: "quick (default, in-tool) or deep (background job, followUp delivery)",
        }),
      ),
      avoidQuestions: Type.Optional(
        Type.Array(Type.String(), {
          description: "Questions already asked in earlier runs — never repeated",
        }),
      ),
      knownSources: Type.Optional(
        Type.Array(Type.String(), {
          description: "URLs already collected — skipped",
        }),
      ),
    }),

    async execute(_toolCallId, params, _signal, onUpdate, ctx) {
      configureEnv(ctx.cwd);
      onUpdate?.({
        content: [{ type: "text" as const, text: "🔬 Researching knowledge base and web…" }],
        details: {},
      });

      const question = (params.question ?? "").trim();
      if (!question) {
        return {
          content: [{ type: "text" as const, text: "📭 No question provided." }],
          details: { jobId: "", statePath: "", digest: null },
        };
      }
      const authResult = await resolveToolAuth(ctx);
      if ("error" in authResult) {
        return {
          content: [{ type: "text" as const, text: authResult.error }],
          details: { jobId: "", statePath: "", digest: null },
        };
      }
      const { auth } = authResult;

      const deep = params.mode === "deep";
      const profile: GateProfile = deep ? ASK_DEEP_PROFILE : ASK_QUICK_PROFILE;
      const jobId = `ask-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
      const knowledgeDir = getKnowledgeConfig(ctx.cwd).dir;
      const statePath = checkpointPathFor(knowledgeDir, jobId);
      const seed = {
        askedQuestions: (params.avoidQuestions ?? []).map((s) => s.trim()).filter(Boolean),
        visited: (params.knownSources ?? []).filter(Boolean).map(canonicalizeUrl),
      };
      const deps = buildResearchDeps(ctx, auth, { allowEscalation: !deep });

      const deliver = (state: ResearchState, path: string): void => {
        pi.sendUserMessage(
          `🔬 Deep research finished for "${question}":\n\n${renderToolResult(state, path)}`,
          { deliverAs: "followUp" },
        );
      };
      const deliverFailure = (jobLabel: string, e: unknown): void => {
        const msg = e instanceof Error ? e.message : String(e);
        pi.sendUserMessage(`🔬 Deep research ${jobLabel} for "${question}": ${msg.slice(0, 200)}`, {
          deliverAs: "followUp",
        });
      };

      if (deep) {
        void runResearch(deps, { question, mode: "breadth", profile, jobId, seed })
          .then((state) => deliver(state, statePath))
          .catch((e: unknown) => deliverFailure("failed", e));
        return {
          content: [
            {
              type: "text" as const,
              text: `🔬 Deep research started (job ${jobId}). Results will arrive as a follow-up message.`,
            },
          ],
          details: { jobId, statePath, mode: "deep" },
        };
      }

      const state = await runResearch(deps, {
        question,
        mode: "breadth",
        profile,
        jobId,
        seed,
      });

      let deepJobId: string | undefined;
      if (state.stage === "ESCALATED" && state.escalation?.escalate) {
        deepJobId = `${jobId}-deep`;
        const deepDeps = buildResearchDeps(ctx, auth, {});
        const deepPath = checkpointPathFor(knowledgeDir, deepJobId);
        void runResearch(deepDeps, {
          question,
          mode: "depth",
          profile: ASK_DEEP_PROFILE,
          jobId: deepJobId,
          seed: {
            visited: state.visited,
            summaries: state.summaries,
            askedQuestions: state.askedQuestions,
          },
        })
          .then((s) => deliver(s, deepPath))
          .catch((e: unknown) => deliverFailure("failed", e));
      }

      return {
        content: [{ type: "text" as const, text: renderToolResult(state, statePath, deepJobId) }],
        details: {
          jobId,
          deepJobId,
          statePath,
          digest: buildDigest(state),
          answer: state.synthesis ?? "",
          sources: state.summaries,
        },
      };
    },
  });
}
