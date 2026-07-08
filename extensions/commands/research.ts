/**
 * /research command — iterative academic research workflow.
 *
 * Decomposes a topic via WHY/HOW/WHAT decomposition using the LLM, then outputs
 * a structured research plan for the agent to execute step by step.
 * First evaluates whether existing PARA docs already cover the topic.
 *
 * @module extensions/commands/research
 */

import { complete } from "@earendil-works/pi-ai";

import { DECOMPOSITION_PROMPT, formatResearchPlan } from "./research-format.js";
import {
  callLlmWithLoader,
  RESEARCH_SUFFICIENCY_PROMPT,
  type LlmCallResult,
  type SufficiencyResult,
} from "./research-llm.js";
import { createDocument } from "../../common/createDocument.js";
import { ensureNotesDb } from "../../common/notesDb.js";
import { searchDocs } from "../para-knowledge/db-sqlite.js";

import type { SearchResult } from "../para-knowledge/sqlite-types.js";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

/** Human-readable description shown in /commands list */
export const description = "Run iterative academic research on a topic";

/**
 * Handle a sufficiency result by creating notes or outputting an inline answer.
 *
 * Extracted to reduce cyclomatic complexity of the main handler.
 *
 * @returns true if the result was handled (sufficient), false if research plan needed.
 */
async function handleSufficiencyResult(
  sufficiencyResult: SufficiencyResult,
  topic: string,
  cwd: string,
  pi: ExtensionAPI,
): Promise<boolean> {
  if (!sufficiencyResult.sufficient) return false;

  // Multi-note creation path
  if (sufficiencyResult.createNote && sufficiencyResult.notes?.length) {
    const created: Array<{ path: string; linkCount: number }> = [];
    for (const note of sufficiencyResult.notes) {
      const doc = await createDocument(
        {
          title: note.title,
          content: note.content,
          tags: note.tags,
          area: "Resources",
          description: note.content.replace(/\n+/g, " ").slice(0, 200).replace(/@\w+/g, "").trim(),
        },
        { cwd },
      );
      created.push(doc);
    }
    const safeTopic = topic.slice(0, 50).replace(/`/g, "");
    pi.sendUserMessage(
      `## Research Answer: ${topic}\n\n${sufficiencyResult.answer}\n\n---\n` +
        `📄 Created ${created.length} atomic notes covering this topic.\n\n` +
        `**Next**: Run \`commit_changes\` with \`docs: research ${safeTopic}\`. If the last commit was a related docs commit, use \`commit_amend\` instead.`,
    );
    return true;
  }

  // Legacy single-note creation path
  if (sufficiencyResult.createNote && sufficiencyResult.noteContent) {
    const doc = await createDocument(
      {
        title: sufficiencyResult.noteTitle ?? topic,
        content: sufficiencyResult.noteContent,
        tags: sufficiencyResult.noteTags ?? ["generated"],
        area: "Resources",
        description: sufficiencyResult.answer
          .replace(/\n+/g, " ")
          .slice(0, 200)
          .replace(/@\w+/g, "")
          .trim(),
      },
      { cwd },
    );
    const safeTopic = topic.slice(0, 50).replace(/`/g, "");
    const linkMsg =
      doc.linkCount > 0
        ? `\n🔗 Auto-linked to ${doc.linkCount} related note${doc.linkCount === 1 ? "" : "s"}.`
        : "";
    pi.sendUserMessage(
      `## Research Answer: ${topic}\n\n${sufficiencyResult.answer}\n\n---\n` +
        `📄 New note created: \`${doc.path}\`${linkMsg}\n\n` +
        `**Next**: Run \`commit_changes\` with \`docs: research ${safeTopic}\`. If the last commit was a related docs commit, use \`commit_amend\` instead.`,
    );
    return true;
  }

  // No note: inline answer only
  pi.sendUserMessage(
    `## Research Answer: ${topic}\n\n${sufficiencyResult.answer}\n\n---\n` +
      `*Based on existing knowledge — no new note created.*`,
  );
  return true;
}

/**
 * Create the /research command handler.
 *
 * Factory pattern: captures the ExtensionAPI reference so the handler
 * can inject structured outputs (inline answer or research plan) via
 * pi.sendUserMessage().
 *
 * Flow:
 * 1. Search existing PARA docs for the topic
 * 2. LLM evaluates sufficiency of existing knowledge (strict prompt)
 * 3. If sufficient:
 *    a. If createNote + notes[] → create multiple atomic documents
 *    b. If createNote + noteContent → create single atomic document (legacy)
 *    c. Else → output inline answer with @citekey citations, no new note
 * 4. If insufficient: WHY/HOW/WHAT decomposition + structured research plan
 *
 * @param pi  The pi extension API instance.
 * @returns   The command handler function.
 */
/**
 * Resolve auth for the selected model.
 *
 * Returns { ok: true, apiKey, headers } if authentication succeeds,
 * or notifies the user and returns { ok: false } on failure.
 */
async function resolveAuth(ctx: ExtensionCommandContext): Promise<
  | {
      ok: true;
      apiKey: string;
      headers?: Record<string, string>;
      model: Parameters<typeof complete>[0];
    }
  | { ok: false }
> {
  if (!ctx.model) {
    ctx.ui.notify("No model selected. Please select a model first (Ctrl+P).", "error");
    return { ok: false };
  }

  const model = ctx.model as Parameters<typeof complete>[0];
  try {
    const result = await ctx.modelRegistry.getApiKeyAndHeaders(model);
    if (!result.ok || !result.apiKey) {
      ctx.ui.notify(`❌ No API key for ${(model as { provider: string }).provider}`, "error");
      return { ok: false };
    }
    return { ok: true, apiKey: result.apiKey, headers: result.headers, model };
  } catch (e) {
    ctx.ui.notify(`❌ Auth error: ${e instanceof Error ? e.message : String(e)}`, "error");
    return { ok: false };
  }
}

export function createHandler(pi: ExtensionAPI) {
  return async (args: string, ctx: ExtensionCommandContext): Promise<void> => {
    const topic = args.trim();

    if (!topic) {
      ctx.ui.notify("Usage: /research <topic> — please provide a research topic.", "warning");
      return;
    }

    if (typeof ctx.ui.custom !== "function") {
      ctx.ui.notify("/research requires interactive (TUI) mode.", "error");
      return;
    }

    const auth = await resolveAuth(ctx);
    if (!auth.ok) return;
    const { model, apiKey, headers } = auth;

    try {
      const db = await ensureNotesDb(ctx.cwd);
      const existingDocs: SearchResult[] = searchDocs(db, topic);
      const docsCtx: string =
        existingDocs.length > 0
          ? existingDocs
              .map((d) => `## ${d.title} (${d.path})\n${d.body.slice(0, 1500)}`)
              .join("\n\n")
          : "No existing documents found for this topic.";

      // Step 1: Evaluate sufficiency of existing knowledge
      const sufficiencyResult = await ctx.ui.custom<LlmCallResult<SufficiencyResult>>(
        (tui, theme, _kb, done) =>
          callLlmWithLoader(
            tui,
            theme,
            done,
            "🔍 Evaluating existing knowledge...",
            model,
            { apiKey, headers },
            RESEARCH_SUFFICIENCY_PROMPT,
            [{ type: "text", text: `Topic: ${topic}\n\nExisting documents:\n${docsCtx}` }],
            (text) => {
              try {
                return JSON.parse(text) as SufficiencyResult;
              } catch {
                return null;
              }
            },
          ),
      );

      if (!sufficiencyResult.ok) {
        if (sufficiencyResult.type === "cancelled") {
          ctx.ui.notify("Research cancelled.", "info");
        } else {
          ctx.ui.notify(`❌ Research failed: ${sufficiencyResult.message}`, "error");
        }
        return;
      }

      if (await handleSufficiencyResult(sufficiencyResult.value, topic, ctx.cwd, pi)) {
        return;
      }

      // Step 2: Decompose into WHY/HOW/WHAT question tree
      const questionTree = await ctx.ui.custom<LlmCallResult<string>>((tui, theme, _kb, done) =>
        callLlmWithLoader(
          tui,
          theme,
          done,
          "🔬 Decomposing research topic...",
          model,
          { apiKey, headers },
          DECOMPOSITION_PROMPT,
          [{ type: "text", text: topic }],
          (text) => text,
        ),
      );

      if (!questionTree.ok) {
        if (questionTree.type === "cancelled") {
          ctx.ui.notify("Research plan generation cancelled.", "info");
        } else {
          ctx.ui.notify(`❌ Research plan generation failed: ${questionTree.message}`, "error");
        }
        return;
      }

      pi.sendUserMessage(formatResearchPlan(topic, questionTree.value));
      await Promise.resolve();
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      ctx.ui.notify(`❌ /research error: ${msg}`, "error");
    }
  };
}
